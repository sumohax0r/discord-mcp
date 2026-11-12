import test from 'node:test';
import assert from 'node:assert/strict';
import {splitReply} from '../src/bot.js';
import {generate} from '../src/providers.js';
import {defaults} from '../src/store.js';

test('long replies preserve text and prefer paragraphs',()=>{
  const first='A'.repeat(1000)+'\n\n',second='B'.repeat(1000)+'\n\n';
  const text=first+second+'Final paragraph.';
  const chunks=splitReply(text);
  assert.equal(chunks[0],first);
  assert.equal(chunks.join(''),text);
  assert.ok(chunks.every(c=>c.length<=1900));
});
test('oversized paragraphs fall back to lines, words, and safe character splits',()=>{
  for(const text of [('word '.repeat(700)),('line\n'.repeat(700)),('a'.repeat(1899)+'😀'+'z'.repeat(2100))]){
    const chunks=splitReply(text);
    assert.equal(chunks.join(''),text);
    assert.ok(chunks.every(c=>c.length<=1900&&!/[\uD800-\uDBFF]$/.test(c)));
  }
});
test('provider limit is explicit and long complete responses are not silently sliced',async()=>{
  for(const provider of ['anthropic','openai'])for(const limited of [false,true]){
    const body='A'.repeat(13000);
    const result=await generate(provider,defaults,{anthropicKey:'test',openaiKey:'test'},[],async(_url,options)=>{
      const request=JSON.parse(options.body);
      assert.equal(request.max_tokens??request.max_output_tokens,4096);
      return new Response(JSON.stringify(provider==='anthropic'?{content:[{type:'text',text:body}],stop_reason:limited?'max_tokens':'end_turn'}:{output:[{content:[{type:'output_text',text:body}]}],status:limited?'incomplete':'completed'}));
    });
    assert.ok(result.startsWith(body));
    if(limited)assert.match(result,/answer is incomplete.*response limit/);
    else assert.equal(result,body);
  }
});
