export async function generate(provider, config, secrets, messages, fetcher=fetch) {
  const isOpenAI=provider==='openai';
  if(!isOpenAI && provider!=='anthropic')throw new Error('Unknown AI provider.');
  const key=secrets[isOpenAI?'openaiKey':'anthropicKey'];
  if(!key)throw new Error(`${isOpenAI?'OpenAI':'Anthropic'} API key is not configured.`);
  const response=await fetcher(isOpenAI?'https://api.openai.com/v1/responses':'https://api.anthropic.com/v1/messages',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),
    headers:isOpenAI?{'Content-Type':'application/json',Authorization:`Bearer ${key}`}:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
    body:JSON.stringify(isOpenAI?{model:config.openaiModel,instructions:config.systemPrompt,input:messages,max_output_tokens:config.maxOutputTokens,store:false}:{model:config.anthropicModel,system:config.systemPrompt,messages,max_tokens:config.maxOutputTokens})
  });
  // Provider error bodies may contain user input or credentials; never return or log them.
  if(!response.ok){await response.body?.cancel();throw new Error(`${isOpenAI?'OpenAI':'Anthropic'} returned HTTP ${response.status}. Check the key, model access, quota and billing.`);}
  const data=await response.json();
  const text=isOpenAI?(data.output??[]).flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n'):(data.content??[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
  if(!text.trim())throw new Error('The provider returned no text. Try a larger output limit or a different model.');
  const limited=isOpenAI?data.status==='incomplete':['max_tokens','model_context_window_exceeded'].includes(data.stop_reason);
  if(limited){
    const command=isOpenAI?'!chatgpt continue':'!claude continue';
    return `${text}\n\n---\nThis answer is incomplete because the response limit was reached. Send \`${command}\` in this channel to pick up where it stopped.`;
  }
  return text;
}
