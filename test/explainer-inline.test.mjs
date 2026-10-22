import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInline,renderInline} from '../archify/explainer/inline.mjs';

test('inline content preserves escaped literals and safe text while exposing reference semantics',()=>{
  const source='**Check first** `GET <key>`, then see [Redis](node:path.redis), [request path](route:path.api~db) and [evidence](source:trace).\\*';
  const parsed=parseInline(source);
  assert.deepEqual(parsed.diagnostics,[]);
  assert.deepEqual(parsed.references.map(({kind,diagram,node,from,to,id})=>({kind,diagram,node,from,to,id})),[
    {kind:'node',diagram:'path',node:'redis',from:undefined,to:undefined,id:undefined},
    {kind:'route',diagram:'path',node:undefined,from:'api',to:'db',id:undefined},
    {kind:'source',diagram:undefined,node:undefined,from:undefined,to:undefined,id:'trace'}
  ]);
  const html=renderInline(source);
  assert.match(html,/<strong>Check first<\/strong>/);
  assert.match(html,/<code>GET &lt;key&gt;<\/code>/);
  assert.match(html,/data-diagram-hash="route=api~db"/);
  assert.match(html,/href="#source-trace"/);
  assert.ok(html.endsWith('.*'));
});

test('unsupported or executable author input fails with located repair guidance',()=>{
  for(const input of ['<img src=x onerror=alert(1)>','[run](javascript:alert(1))','[run](data:text/html,test)','[run](https://user:password@example.com)','[unclosed](source:foo','![image](image.png)','~~removed~~','**unclosed']){
    const parsed=parseInline(`plain\n${input}`,{line:20,component:'prose',panelId:'overview',input:'draft.md'});
    assert.ok(parsed.diagnostics.length,input);
    for(const d of parsed.diagnostics){assert.equal(d.subject.line,21);assert.equal(d.subject.component,'prose');assert.ok(d.evidence.reason);assert.ok(d.evidence.example);}
    assert.throws(()=>renderInline(input),error=>Array.isArray(error.archifyDiagnostics));
  }
});

test('HTTP references preserve parentheses and escape attributes without evaluating label markup',()=>{
  const html=renderInline('[A & B](https://example.com/topic_(one)?x=1&y=2)');
  assert.match(html,/href="https:\/\/example.com\/topic_\(one\)\?x=1&amp;y=2"/);
  assert.match(html,/>A &amp; B<\/a>/);
  assert.match(html,/rel="noopener noreferrer"/);
  assert.equal(renderInline('a < b & c > d'),'a &lt; b &amp; c &gt; d');
});

test('typical-value qualifications become numbered real footnotes shared across text fields',()=>{
  const footnotes=[];
  const a=renderInline('[1 ms](typical:indicative, not measured on this page)',{footnotes});
  const b=renderInline('[fast](typical:depends on the data volume)',{footnotes});
  assert.match(a,/href="#explainer-typical-1"/);
  assert.match(b,/href="#explainer-typical-2"/);
  assert.deepEqual(footnotes.map(x=>x.text),['indicative, not measured on this page','depends on the data volume']);
  assert.match(renderInline('[fast](typical:measure locally)'),/measure locally/);
});

test('escaped backslashes do not consume a following closing emphasis delimiter',()=>{
  const source=String.raw`**path\\**`;
  assert.deepEqual(parseInline(source).diagnostics,[]);
  assert.equal(renderInline(source),'<strong>path\\</strong>');
  assert.equal(renderInline(String.raw`**literal\* still bold**`),'<strong>literal* still bold</strong>');
});
