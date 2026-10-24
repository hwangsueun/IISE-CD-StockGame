function project(x, transform) {
  const z=x.map((v,i)=>(v-transform.center[i])/transform.scale[i]);
  return transform.axes.map(axis=>axis.reduce((sum,w,i)=>sum+w*z[i],0));
}
function fit(config, prepared) {
  if (!config.reduction || config.reduction==='none') return prepared;
  const {samples,metadata}=prepared;
  const transform=require('./nativeModels').runScript('fit_reduction.py',{
    x:samples.map(s=>s.x), keys:metadata.keys, weights:config.terms.map(t=>t.weight),
    method:config.reduction, components:config.components,
  });
  transform.inputRepresentation=metadata.representation;
  return {samples:samples.map(s=>({...s,x:project(s.x,transform)})),
    metadata:{...metadata,transform,representation:'raw',keys:transform.axes.map((_,i)=>`axis${i+1}`)}};
}
module.exports={fit,project};
