import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from 'parse5';
import {layoutExplainerPanels} from '../archify/explainer/layout.mjs';
import {parseExplainer} from '../archify/explainer/parse.mjs';
import {prepareExplainer} from '../archify/explainer/prepare.mjs';
import {renderExplainer} from '../archify/explainer/render.mjs';
const panel=(id,type='prose',extra={})=>({id,title:id,blocks:[{id:id+'-body',type,text:'Short.',...extra}]});
const document=panels=>({meta:{id:'board',title:'Board'},answer:{summary:'Conclusion.'},panels,sources:[]});
const all=(n,fn)=>[...(fn(n)?[n]:[]),...(n.childNodes||[]).flatMap(c=>all(c,fn))];
const attr=(n,key)=>n.attrs?.find(a=>a.name===key)?.value;

test('board preserves order, content widths and fills each row including the last',()=>{
 const d=document([panel('compare','comparison',{columns:['A','B']}),panel('short'),panel('long','list',{items:['A'.repeat(100)]}),panel('third'),panel('code','code'),panel('end')]);
 const rows=layoutExplainerPanels(d);
 assert.deepEqual(rows.map(row=>row.map(({id,span})=>[id,span])),[[['answer',5],['compare',7]],[['short',4],['long',4],['third',4]],[['code',8],['end',4]]]);
 const mixed=layoutExplainerPanels(document([panel('large','comparison',{columns:['A','B','C']}),panel('short'),panel('long','prose',{text:'x'.repeat(400)})]));
 assert.deepEqual(mixed.map(row=>row.map(({id,span})=>[id,span])),[[['answer',5],['large',7]],[['short',4],['long',8]]]);
 const figure=layoutExplainerPanels(document([panel('figure','diagram')]),{'figure-body':{svg:'<svg viewBox="0 0 900 500">'}});
 assert.deepEqual(figure[0].map(p=>[p.id,p.span]),[['answer',4],['figure',8]]);
 const growing=layoutExplainerPanels(document([panel('long','prose',{text:'x'.repeat(400)})]));assert.deepEqual(growing[0].map(p=>p.span),[5,7]);
 for(const packed of [layoutExplainerPanels(document([])),rows,mixed,growing])assert.ok(packed.every(row=>row.reduce((sum,p)=>sum+p.span,0)===12));
});

test('native width is estimated from the prepared viewBox; authored spans stay exact',()=>{
 const d=document([panel('normal','diagram'),panel('wide','diagram'),{...panel('fixed'),span:3},{...panel('fixed-other'),span:4}]);
 const rows=layoutExplainerPanels(d,{'normal-body':{svg:'<svg viewBox="0 0 600 500">'},'wide-body':{svg:'<svg viewBox="0 0 1100 500">'}});
 assert.equal(rows.flat().find(p=>p.id==='wide').span,12);
 assert.equal(rows.flat().find(p=>p.id==='fixed').span,3);assert.equal(rows.flat().find(p=>p.id==='fixed-other').span,4);assert.equal(rows.at(-1).at(-1).spacer,true);
 assert.ok(rows.every(row=>row.reduce((sum,p)=>sum+p.span,0)===12));
});
