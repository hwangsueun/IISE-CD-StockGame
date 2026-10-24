"""Training-only standardization and optional hypothesis-constrained PCA."""
import json
import sys
import numpy as np


def fit(p):
    x = np.asarray(p['x'], dtype=float)
    center, scale = x.mean(axis=0), x.std(axis=0)
    scale[scale < 1e-10] = 1
    z = (x-center)/scale
    k = p['components']
    if not np.isfinite(z).all() or not 0 < k < x.shape[1]:
        raise ValueError('차원 축소 입력과 축 개수를 확인해 주세요.')
    axes = []
    residual = z.copy()
    if p['method']=='anchoredPca':
        anchor = np.asarray(p['weights'],dtype=float)
        if np.linalg.norm(anchor) < 1e-10: raise ValueError('가설 축의 가중치를 지정해 주세요.')
        anchor /= np.linalg.norm(anchor)
        axes.append(anchor)
        residual -= np.outer(z @ anchor,anchor)
    _,_,vectors = np.linalg.svd(residual,full_matrices=False)
    for axis in vectors:
        if len(axes)==k: break
        for old in axes: axis=axis-np.dot(axis,old)*old
        norm=np.linalg.norm(axis)
        if norm<1e-8: continue
        axis=axis/norm
        if axis[np.argmax(np.abs(axis))]<0: axis=-axis
        axes.append(axis)
    if len(axes)!=k or float(np.sum(z*z)) < 1e-10:
        raise ValueError('변화가 부족해 차원 축소를 학습할 수 없습니다.')
    axes=np.asarray(axes)
    explained=np.sum((z @ axes.T)**2,axis=0)/np.sum(z*z)
    return dict(method=p['method'], inputKeys=p['keys'], center=center.tolist(), scale=scale.tolist(),
                axes=axes.tolist(), explained=explained.tolist(), sampleCount=len(x),
                note='Selected daily indicators; training-only standardized projection. Not intraday fARCH.')


if __name__=='__main__':
    try:
        with open(sys.argv[1],encoding='utf-8') as f: payload=json.load(f)
        print(json.dumps(fit(payload),allow_nan=False))
    except ValueError as e: print(json.dumps({'error':str(e)},ensure_ascii=False))
