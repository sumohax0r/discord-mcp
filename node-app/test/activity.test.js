import test from 'node:test';
import assert from 'node:assert/strict';
import {Bot} from '../src/bot.js';
import {defaults} from '../src/store.js';

for(const fails of [false,true])test(`acknowledgment and typing lifecycle, provider failure=${fails}`,async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const store={state:{config:{...defaults,enabled:true,guildId:'guild',channelIds:['channel'],allowEveryone:true},secrets:{anthropicKey:'test'}},reserveRequest(){}};
  let finish,typing=0;
  const reactions=[],replies=[];
  const bot=new Bot(store,()=>new Promise((resolve,reject)=>{finish=()=>fails?reject(new Error('Anthropic unavailable')):resolve('Hello');}));
  bot.client={user:{id:'bot'}};
  const pending=bot.onMessage({guildId:'guild',channelId:'channel',content:'!claude hello',author:{id:'user',bot:false},channel:{sendTyping:async()=>{typing++;}},react:async emoji=>reactions.push(emoji),reply:async body=>replies.push(body.content)});
  await new Promise(r=>setImmediate(r));
  assert.deepEqual(reactions,['👀']);
  assert.equal(typing,1);
  t.mock.timers.tick(8000);
  await new Promise(r=>setImmediate(r));
  assert.equal(typing,2);
  finish();await pending;
  t.mock.timers.tick(16000);
  assert.equal(typing,2);
  assert.equal(replies.length,1);
  assert.match(replies[0],fails?/Anthropic unavailable/:/Hello/);
  clearInterval(bot.cleanup);
});
