"""Frozen risk estimates. HAR uses log Parkinson volatility; GARCH uses percent returns."""
import json
import sys
import warnings
import numpy as np
from scipy.optimize import minimize
from sklearn.linear_model import Ridge, Lasso


def garch(series):
    mu = float(np.mean(series)); residual = series - mu
    initial = max(float(np.var(residual)), 1e-6)
    def variances(p):
        omega, alpha, beta = p; h = initial; out = []
        for e in residual:
            out.append(h); h = max(1e-8, omega + alpha * e * e + beta * h)
        return np.asarray(out), h
    def loss(p):
        h, _ = variances(p)
        return float(np.mean(np.log(h) + residual * residual / h))
    fits = [minimize(loss, [initial * (1-a-b), a, b], method='SLSQP',
                    bounds=[(1e-8, initial*10+1), (0, .994), (0, .994)],
                    constraints=[{'type':'ineq', 'fun':lambda p: .995-p[1]-p[2]}],
                    options={'maxiter':150, 'ftol':1e-8}) for a,b in [(.08,.85), (.15,.6)]]
    fits = [f for f in fits if f.success and np.isfinite(f.fun) and sum(f.x[1:]) <= .995001]
    if not fits: raise ValueError('GARCH 최적화가 수렴하지 않았습니다. 다른 종목이나 위험 모델을 선택해 주세요.')
    best = min(fits, key=lambda f:f.fun); h, next_h = variances(best.x)
    return dict(mu=mu, omega=float(best.x[0]), alpha=float(best.x[1]), beta=float(best.x[2]),
                nextVariance=float(next_h), residuals=(residual / np.sqrt(h)).tolist(), objective=float(best.fun))


def regression(x, y, sparse):
    center, scale = np.mean(x,axis=0), np.std(x,axis=0)
    scale[scale < 1e-10] = 1
    z = (x-center)/scale
    initial = Ridge(alpha=1).fit(z,y)
    if not sparse:
        coefficients = np.linalg.lstsq(np.column_stack([np.ones(len(z)), z]), y, rcond=None)[0]
        return dict(coefficients=(coefficients[1:]/scale).tolist(), intercept=float(coefficients[0]-np.dot(coefficients[1:]/scale,center)), penalty=None)
    else:
        weights = 1/np.maximum(np.abs(initial.coef_), .01)
        best = None
        for penalty in [.001,.003,.01,.03,.1]:
            with warnings.catch_warnings():
                warnings.simplefilter('ignore')
                candidate = Lasso(alpha=penalty, max_iter=10000, tol=1e-7).fit(z/weights,y)
            if candidate.n_iter_ >= 10000: continue
            coefficients = candidate.coef_/weights
            error = np.mean((y-(candidate.intercept_+np.sum(z*coefficients,axis=1)))**2)
            bic = len(y)*np.log(max(error,1e-12)) + (np.count_nonzero(coefficients)+1)*np.log(len(y))
            if best is None or bic < best[0]: best = (bic, coefficients, candidate.intercept_, penalty)
        if best is None: raise ValueError('희소 계수 추정이 수렴하지 않았습니다. 다른 시차나 위험 모델을 선택해 주세요.')
        _, coefficients, intercept, chosen = best
        return dict(coefficients=(coefficients/scale).tolist(), intercept=float(intercept-np.dot(coefficients/scale,center)), penalty=chosen)


def harfit(v, short, long, method, limit=None):
    xs, ys = [], []
    for t in range(long-1,len(v)-1):
        xs.append(np.concatenate([v[t],np.mean(v[t-short+1:t+1],axis=0),np.mean(v[t-long+1:t+1],axis=0)]))
        ys.append(v[t+1])
    x,y = np.asarray(xs),np.asarray(ys)
    n = limit or len(y); models = []
    for j in range(v.shape[1]):
        columns = [j,j+v.shape[1],j+2*v.shape[1]] if method == 'har' else list(range(x.shape[1]))
        fitted = regression(x[:n,columns],y[:n,j],method=='sparseVhar'); fitted['columns']=columns; models.append(fitted)
    predicted = np.column_stack([m['intercept']+np.sum(x[:,m['columns']]*m['coefficients'],axis=1) for m in models])
    return models,float(np.mean((predicted[n:]-y[n:])**2)) if n<len(y) else None


def correlation(q):
    d = np.sqrt(np.diag(q))
    return q / np.outer(d, d)


def dcc_fit(z, qbar):
    def filter_q(p):
        a,b = p; q = qbar.copy(); losses = []
        for row in z:
            r = correlation(q)
            sign, determinant = np.linalg.slogdet(r)
            if sign <= 0: return float('inf'), q
            losses.append(determinant + row @ np.linalg.solve(r,row))
            q = (1-a-b)*qbar + a*np.outer(row,row) + b*q
        return float(np.mean(losses)), q
    fits = [minimize(lambda p:filter_q(p)[0], start, method='SLSQP',
        bounds=[(0,.994),(0,.994)], constraints=[{'type':'ineq','fun':lambda p:.995-sum(p)}],
        options={'maxiter':150,'ftol':1e-8}) for start in [[.03,.9],[.1,.6]]]
    fits = [f for f in fits if f.success and np.isfinite(f.fun) and sum(f.x)<=.995001]
    if not fits: raise ValueError('DCC 상관관계 추정이 수렴하지 않았습니다.')
    f = min(fits,key=lambda f:f.fun)
    return dict(alpha=float(f.x[0]), beta=float(f.x[1]), qbar=qbar.tolist(),
                nextQ=filter_q(f.x)[1].tolist(), objective=float(f.fun))


def fit(payload):
    c, rows, ids = payload['config'], payload['rows'], payload['ids']
    if len(rows)<200: raise ValueError('위험 모델에는 해당 종목들의 연속된 과거 관측이 최소 200개 필요합니다.')
    returns = np.array([r['returns'] for r in rows]); vol = np.array([r['logVol'] for r in rows])
    out = dict(method=c['riskModel'], ids=ids, trainedFrom=rows[0]['date'], trainedThrough=rows[-1]['date'],
               sampleCount=len(rows), input='log Parkinson daily volatility', fit='frozen before evaluation',
               lastLogVol=vol[-22:].tolist(), garch=None, regressions=None)
    if c['riskModel'] in ['har','vhar','sparseVhar']:
        pairs = [(c['riskShort'],c['riskLong'])] if c['riskLagMode']=='fixed' else [(4,17),(5,22),(7,20)]
        diagnostics=[]
        for short,long in pairs:
            n = int(len(vol)*.8)-long
            _, error = harfit(vol,short,long,c['riskModel'],n)
            diagnostics.append(dict(short=short,long=long,validationMSE=error))
        best = min(diagnostics,key=lambda d:d['validationMSE'])
        models,_ = harfit(vol,best['short'],best['long'],c['riskModel'])
        out.update(regressions=models,short=best['short'],long=best['long'],lagCandidates=diagnostics,
                   lagSelection='chronological final 20 percent within training data' if len(pairs)>1 else 'user selected',
                   coefficientCount=sum(int(np.count_nonzero(m['coefficients'])) for m in models))
    if c['riskModel']=='ewma':
        mu = returns.mean(axis=0); residual = returns-mu
        covariance = np.cov(residual,rowvar=False)
        covariance = .95*covariance+.05*np.diag(np.maximum(np.diag(covariance),1e-8))
        decay = c['covarianceDecay']
        for e in residual: covariance = decay*covariance+(1-decay)*np.outer(e,e)
        out.update(ewma=dict(mu=mu.tolist(),decay=decay,nextCovariance=covariance.tolist()),
                   input='joint percent close-to-close returns')
    if c['riskModel'] in ['garch','ccc','dcc'] or c['stressTest']:
        gs = [garch(returns[:,j]) for j in range(len(ids))]
        residuals = np.column_stack([g.pop('residuals') for g in gs]); out['garch']=gs
        out['input'] = 'percent close-to-close returns' if c['riskModel']=='garch' else out['input']
        if c['riskModel'] in ['ccc','dcc']:
            qbar = np.cov(residuals,rowvar=False,bias=True)
            qbar = .95*qbar+.05*np.diag(np.maximum(np.diag(qbar),1e-8))
            out.update(correlation=correlation(qbar).tolist(), input='joint percent close-to-close returns',
                       correlationShrinkage=.05)
            if c['riskModel']=='dcc': out['dcc']=dcc_fit(residuals,qbar)
        if c['stressTest']:
            if len(rows)<300: raise ValueError('공동 손실 실험에는 공통 과거 관측이 최소 300개 필요합니다. 학습 기간을 늘리거나 다른 종목을 선택해 주세요.')
            radius = np.linalg.norm(residuals,axis=1); k=max(30,int(np.sqrt(len(rows))))
            order=np.argsort(radius); threshold=float(radius[order[-k-1]])
            extreme=residuals[order[-k:]]; tailrad=radius[order[-k:]]
            if threshold<=0 or np.mean(np.log(tailrad/threshold))<=0: raise ValueError('꼬리 분포를 추정할 수 없습니다.')
            alpha=float(1/np.mean(np.log(tailrad/threshold)))
            corr=np.corrcoef(residuals,rowvar=False); corr=.95*corr+.05*np.eye(len(ids))
            out['stress']=dict(tailIndex=alpha,tailCount=k,threshold=threshold,tailProbability=k/len(rows),
                directions=(extreme/tailrad[:,None]).tolist(),center=residuals[order[:-k]].tolist(),
                cholesky=np.linalg.cholesky(corr).tolist(),seed=2026,paths=3000,
                method='MRV-inspired empirical spectral distribution with Hill tail index; not elliptical likelihood replication')
    return out

if __name__=='__main__':
    try:
        if len(sys.argv) > 1:
            with open(sys.argv[1], encoding='utf-8') as handle: payload = json.load(handle)
        else: payload = json.load(sys.stdin)
        print(json.dumps(fit(payload),allow_nan=False))
    except ValueError as e: print(json.dumps({'error':str(e)},ensure_ascii=False))
