import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseExplainer} from '../archify/explainer/parse.mjs';
import {validateExplainer} from '../archify/explainer/validate.mjs';

const draft = content => `# Cache choice {#cache-choice}\n\nRead the cache first on the request path.\n\n@source docs title="Fixture facts"\n\n## What follows? {#reasoning}\n\n${content}\n`;
const parse = value => { const result=parseExplainer(value,{inputPath:'answer.md'}); assert.ok(result.document,JSON.stringify(result.diagnostics));return result; };

test('explainer author families preserve literal values and normalize typed public data',()=>{
  const result=parse(draft(`A **direct** paragraph with [facts](source:docs).

- First option
- Second option

| Criterion | Option A | Option B |
| --- | --- | --- |
| Cost | Low {good:Affordable} | High {bad} |
| Syntax | \`a|b\` {caution} | x\\|y {good} |

@callout id=caution level=warning title="Condition"
| Check the premise first. |

@facts id=facts
| Token | literal\\|value |

@metric id=metric label="Latency" value=12.5 limit=20 unit=ms typical=true

@steps id=steps
| first-step | Read the explanation |

@code id=snippet source=repo language=js

@image id=image path=images/path.png alt="Request path"

@diff id=change caption="Literal change"
\`\`\`diff
-const tag = '<old>'; // | literal
+const tag = '<new>'; // $HOME
\`\`\`
`));
  const blocks=result.document.panels[0].blocks;
  assert.deepEqual(blocks.map(block=>block.type),['prose','list','comparison','callout','facts','metric','steps','code','image','diff']);
  assert.equal(blocks[2].rows[0].cells[0].verdict,'Affordable');
  assert.equal(blocks[2].rows[1].cells[0].text,'`a|b`');
  assert.equal(blocks[2].rows[1].cells[1].text,'x|y');
  assert.equal(blocks[4].entries[0].value,'literal|value');
  assert.equal(blocks[5].value,12.5);
  assert.equal(blocks.at(-1).text,"-const tag = '<old>'; // | literal\n+const tag = '<new>'; // $HOME");
});

test('automatic heading IDs survive insertion and duplicate headings offer an explicit repair',()=>{
  const original=parse('# Title\n\nAnswer.\n\n## What is A?\n\nA text.\n\n## What is B?\n\nB text.');
  const inserted=parse('# Title\n\nAnswer.\n\n## What is C?\n\nC text.\n\n## What is A?\n\nA text.\n\n## What is B?\n\nB text.');
  assert.deepEqual(inserted.document.panels.slice(1).map(panel=>panel.id),original.document.panels.map(panel=>panel.id));
  assert.deepEqual(inserted.document.panels.slice(1).map(panel=>panel.blocks[0].id),original.document.panels.map(panel=>panel.blocks[0].id));
  const repeated=parseExplainer('# Title\n\nAnswer.\n\n## Same?\n\nText.\n\n## Same?\n\nOther.');
  assert.equal(repeated.document,null);assert.match(repeated.diagnostics[0].evidence.reason,/Duplicate/);assert.match(repeated.diagnostics[0].evidence.example,/\{#/);
  assert.ok(parse('# Title\n\nAnswer.\n\n## Same? {#first}\n\nText.\n\n## Same? {#second}\n\nOther.').document);
});

test('panel offsets enable exact replacement without rewriting untouched source or CRLF',()=>{
  const original='# Title\r\n\r\nConclusion.\r\n\r\n## First? {#first}\r\n\r\nKeep this paragraph.\r\n\r\n## Second? {#second}\r\n\r\nChange this paragraph.\r\n';
  const result=parse(original);const range=result.sourceMap['/panels/1'];
  assert.equal(range.line,9);assert.equal(original.slice(range.start,range.end),'## Second? {#second}\r\n\r\nChange this paragraph.\r\n');
  const next=original.slice(0,range.start)+'## Second? {#second}\r\n\r\nNew content.\r\n'+original.slice(range.end);
  const updated=parse(next);assert.deepEqual(updated.document.panels[0],result.document.panels[0]);assert.equal(updated.document.panels[1].id,'second');
});

test('JSON is not reinterpreted and exact nested field lines survive schema diagnostics',()=>{
  const json=`{\n"schema_version":1,\n"diagram_type":"explainer",\n"meta":{"id":"artifact","title":"Title"},\n"answer":{"summary":"Answer."},\n"panels":[{"id":"panel","title":"Why?","blocks":[{\n"id":"latency","type":"metric","label":"Latency",\n"value":"wrong"\n}]}],\n"sources":[{"id":"facts","title":"Facts"}]\n}`;
  const result=parse(json);assert.equal(result.format,'json');assert.equal(result.document.sources[0].title,'Facts');
  const validated=validateExplainer(result.document,{sourceMap:result.sourceMap});assert.equal(validated.ok,false);
  assert.equal(validated.diagnostics.find(entry=>entry.subject.path==='/panels/0/blocks/0/value').subject.line,8);
  const duplicate=parseExplainer('{"answer":{},"answer":{}}');assert.equal(duplicate.document,null);assert.match(duplicate.diagnostics[0].message,/Duplicate JSON/);
  assert.ok(parseExplainer('{"sources":{}}').document,'valid JSON with the wrong shape should reach schema validation');
});

test('native shorthand preserves api to redis and source file references stay explicit',()=>{
  const result=parse(draft(`@sequence id=request
| actor api | API | backend |
| actor redis | Redis | database |
| api | redis | GET key |

@diagram waterfall id=trace source=trace.waterfall.json

@steps id=walkthrough
| query | Read cache | | request | | api~redis | api-to-redis-1 |`));
  const [sequence,external,steps]=result.document.panels[0].blocks;
  assert.equal(sequence.spec.messages[0].from,'api');assert.equal(sequence.spec.messages[0].to,'redis');
  assert.deepEqual({type:external.diagramType,source:external.source},{type:'waterfall',source:'trace.waterfall.json'});
  assert.deepEqual(steps.items[0].target.route,['api','redis']);
  assert.equal(validateExplainer(result.document).ok,true);
});

test('restricted syntax errors contain a line, component, reason and repair example',()=>{
  const cases=[['@unknown\n| x |',9],['@facts\n| one |',10],['@metric label="Latency" value=Infinity',9],['@callout title="Unclosed',9],['@diff\n```diff\n+new',9],['### Unsupported deep heading',9]];
  for(const [content,line]of cases) {
    const result=parseExplainer(draft(content),{inputPath:'bad.md'});assert.equal(result.document,null,content);
    const issue=result.diagnostics[0];assert.equal(issue.subject.line,line,content);assert.ok(issue.subject.component);assert.ok(issue.evidence.reason);assert.ok(issue.evidence.example);assert.equal(issue.subject.input,'bad.md');
  }
});

test('frozen real format-calibration drafts parse and validate without rewriting their syntax',()=>{
  const drafts=[
    '# Temporary data options\nConclusion: choose A. The team needs somewhere to keep temporary preview data.\n\n## Are the criteria met?\n| Criterion | A | B |\n|---|---|---|\n| Data need not survive a restart | ok | ok |\n| No disk required | ok | ok |\n| No background job required | ok | no |\n',
    '# Cache reads\nThis page explains the flow and did not measure performance.\n\n## How are hits and misses handled?\n1. The API checks Redis first.\n2. On a hit, the API returns the cached value.\n3. On a miss, the API reads the database.\n4. The API refills Redis, then returns the result.\n',
    '# Recording requests\nA request goes through the API to the Store and back to the Client.\n\n## How does a request travel?\n@sequence\nClient | API | request record\nAPI | Store | look up record\nStore | API | return record | return\nAPI | Client | return record | return\n',
  ];
  for(const draft of drafts){const result=parseExplainer(draft,{output:'/tmp/explainer-calibration/result.html'});assert.ok(result.document,JSON.stringify(result.diagnostics));assert.equal(result.document.meta.output,'result.html');const validated=validateExplainer(result.document,{sourceMap:result.sourceMap});assert.equal(validated.ok,true,JSON.stringify(validated.diagnostics));}
});

test('diagram cells retain literal pipes and source map keeps title location after metadata',()=>{
  const result=parse(draft(`@meta locale=en

@sequence id=trace
actor api | API | backend
actor store | Store | database
api | store | Query\\|read
`));
  assert.equal(result.document.panels[0].blocks[0].spec.messages[0].label,'Query|read');assert.equal(result.sourceMap['/meta/title'].line,1);assert.equal(result.sourceMap['/meta/locale'].line,9);
});

test('answer reasons, scope, numbered source syntax and explicit spans normalize without hidden fields',()=>{
 const result=parse('# Title\n\nChoose a modular monolith.\n\n- One deployment\n- Local transactions\n\n@answer scope="An eight-person team"\n@source docs title="Reference" url=https://example.com\n\n## Why? {#why span=7}\n\nRead [docs](source:docs). [](source:docs)\n');
 assert.deepEqual(result.document.answer,{summary:'Choose a modular monolith.',reasons:['One deployment','Local transactions'],scope:'An eight-person team'});
 assert.equal(result.document.panels[0].span,7);assert.equal(validateExplainer(result.document).ok,true);
 assert.equal(result.sourceMap['/answer/reasons/0'].line,5);
 for(const list of ['1. Ordered','- First\n  - Nested'])assert.equal(parseExplainer('# Title\n\nAnswer.\n\n'+list).document,null);
});

test('comparison row IDs stay stable',()=>{
 const result=parse(draft('@comparison columns="A,B"\nCost {#cost-row} | Low {good} | High {bad}'));
 assert.equal(result.document.panels[0].blocks[0].rows[0].id,'cost-row');assert.equal(validateExplainer(result.document).ok,true);
});

test('reason lists immediately follow the conclusion and zero span reaches schema rejection',()=>{
 const separated=parseExplainer('# Title\n\nAnswer.\n\n@answer scope="Scope"\n\n- Late reason\n\n## Why?\n\nText.');assert.equal(separated.document,null);assert.equal(separated.diagnostics[0].subject.component,'answer');
 const zero=parse('# Title\n\nAnswer.\n\n## Why? {#why span=0}\n\nText.');assert.equal(zero.document.panels[0].span,0);assert.equal(validateExplainer(zero.document).ok,false);
});

test('plain code fences become literal snippets, diff fences become diffs, and table corners keep their header',()=>{
 const result=parse(draft('| Need | Output |\n| --- | --- |\n| Read | Diagram |\n\n```bash title="Run tests"\nnpm test -- --grep "a | b"\n```\n\n```diff\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n```'));
 const [table,snippet,diff]=result.document.panels[0].blocks;
 assert.equal(table.labelColumn,'Need');
 assert.deepEqual({type:snippet.type,language:snippet.language,title:snippet.title,text:snippet.text},{type:'snippet',language:'bash',title:'Run tests',text:'npm test -- --grep "a | b"'});
 assert.equal(diff.type,'diff');assert.match(diff.text,/^--- a\/x/);
 assert.equal(validateExplainer(result.document).ok,true);
 assert.equal(parseExplainer(draft('```js\nopen()')).document,null);
 assert.equal(parseExplainer(draft('```js lines=1:2\nx\n```')).document,null);
});

test('a callout may take the following paragraph and may share its panel ID without failing',()=>{
  const {document}=parse('# Title\n\nAnswer.\n\n## Pitfalls {#pitfalls}\n\n@callout id=pitfalls level=warning title="Stop first"\n\nDo not pay before checking the deed.\nAsk for the owner ID.\n\n## Next {#next}\n\nText.');
  const callout=document.panels[0].blocks[0];
  assert.equal(document.panels[0].blocks.length,1);
  assert.equal(callout.id,'pitfalls-callout');
  assert.equal(callout.text,'Do not pay before checking the deed.\nAsk for the owner ID.');
  assert.equal(parseExplainer('# T\n\nA.\n\n## Q {#flow}\n\n@sequence id=flow\n| a | b | hi |').document,null,'a diagram keeps its ID, so a clash with its panel still fails');
});

test('a comparison assessment may be followed by a citation',()=>{
  const {document}=parse('# T\n\nA.\n\n@source law title="Civil code" url=https://example.com/law\n\n## Q {#q}\n\n| Who | Risk |\n| --- | --- |\n| Sublet | Can be ended {bad:Lose both} [](source:law) |');
  const cell=document.panels[0].blocks[0].rows[0].cells[0];
  assert.equal(cell.assessment,'bad');
  assert.equal(cell.verdict,'Lose both');
  assert.equal(cell.text,'Can be ended[](source:law)');
});

test('a source cell ties a shorthand node to a declared source without entering the native spec',()=>{
  const {document}=parse('# T\n\nA.\n\n@source router title="Router" path=src/router.js lines=1:3\n\n## Q {#q}\n\n@architecture id=map\n| api | API | backend | source:router |\n| db | DB | database |\n| api > db | reads |');
  const block=document.panels[0].blocks[0];
  assert.deepEqual(block.nodeSources,{api:'router'});
  assert.ok(!JSON.stringify(block.spec).includes('source:router'));
  const missing=validateExplainer(parse('# T\n\nA.\n\n## Q {#q}\n\n@architecture id=map\n| api | API | backend | source:nope |\n| db | DB | database |\n| api > db | reads |').document);
  assert.equal(missing.ok,false);
});

test('an authored page style is kept and limited to the shipped styles',()=>{
  assert.equal(parse('# T\n\nA.\n\n@meta style=editorial\n\n## Q {#q}\n\nText.').document.meta.style,'editorial');
  assert.equal(validateExplainer(parse('# T\n\nA.\n\n@meta style=neon\n\n## Q {#q}\n\nText.').document).ok,false);
});

test('a badge-only comparison cell and a route written in the node column are accepted',()=>{
  const {document}=parse('# T\n\nA.\n\n## Q {#q}\n\n| Trap | Verdict |\n| --- | --- |\n| Flood car | {bad:Drop} |\n\n@sequence id=flow\n| actor a | A |\n| actor b | B |\n| a | b | hi |\n\n@steps id=walk\n| one | Hello | Detail | flow | a~b |\n| two | Back | Detail | flow | b |');
  assert.deepEqual(document.panels[0].blocks[0].rows[0].cells[0],{text:'Drop',assessment:'bad',verdict:'Drop'});
  assert.deepEqual(document.panels[0].blocks[2].items[0].target,{diagram:'flow',route:['a','b']});
});
