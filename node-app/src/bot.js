import { Client, GatewayIntentBits, Events, PermissionFlagsBits } from 'discord.js';
import { generate } from './providers.js';
export function allowed(c,guildId,channelId,userId) {
  return c.enabled && guildId===c.guildId && c.channelIds.includes(channelId) && (c.allowEveryone||c.userIds.includes(userId));
}
export function parsePrompt(content,botId,defaultProvider) {
  const command=content.match(/^!(chatgpt|claude|reset)\b\s*([\s\S]*)$/i);
  if(command)return {provider:command[1].toLowerCase()==='claude'?'anthropic':'openai',reset:command[1].toLowerCase()==='reset',text:command[2].trim()};
  const mention=new RegExp(`^<@!?${botId}>\\s*`);
  return mention.test(content)?{provider:defaultProvider,text:content.replace(mention,'').trim()}:null;
}
export class Bot {
  constructor(store,reply=generate){this.store=store;this.reply=reply;this.client=null;this.status='Not connected';this.conversations=new Map();this.rates=new Map();this.busy=new Set();this.cancelled=new Set();this.active=0;this.connecting=false;this.generation=0;this.cleanup=setInterval(()=>{const now=Date.now();for(const [k,v] of this.conversations)if(now-v.at>1800000)this.conversations.delete(k);for(const [k,v] of this.rates)if(now-v.at>60000)this.rates.delete(k);},60000);this.cleanup.unref();}
  clear(){this.conversations.clear();this.generation++;}
  async disconnect() {const client=this.client;this.client=null;this.clear();if(client)await client.destroy();this.status='Not connected';}
  async connect() {
    if(this.connecting)throw new Error('A connection attempt is already running.');
    this.connecting=true;
    try {
      if(this.client)await this.client.destroy();this.client=null;this.clear();
      const token=this.store.state.secrets.discordToken;
      if(!token){this.status='Bot token needed';return;}
      const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent],allowedMentions:{parse:[],repliedUser:false},rest:{timeout:15000,retries:1}});
      this.client=client;this.status='Connecting';
      client.on(Events.Error,()=>{this.status='Discord connection error';});
      client.on(Events.ShardError,()=>{this.status='Discord gateway error';});
      client.on(Events.ShardDisconnect,()=>{this.status='Discord disconnected';});
      client.on(Events.ClientReady,()=>{this.status='Connected';});
      client.on(Events.MessageCreate,m=>{void this.onMessage(m).catch(()=>{this.status='A Discord reply failed';});});
      let timer;
      try {await Promise.race([client.login(token),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),25000);})]);}
      catch {await client.destroy();this.client=null;this.status='Connection failed. Check the bot token and Message Content intent.';throw new Error(this.status);}
      finally {clearTimeout(timer);}
    } finally {this.connecting=false;}
  }
  ready(){if(!this.client?.isReady())throw new Error('Connect the Discord bot first.');return this.client;}
  servers(){return [...this.ready().guilds.cache.values()].map(g=>({id:g.id,name:g.name})).sort((a,b)=>a.name.localeCompare(b.name));}
  async channels(guildId) {
    const guild=this.ready().guilds.cache.get(guildId);if(!guild)throw new Error('Server is not available to this bot.');
    const channels=await guild.channels.fetch();
    return [...channels.values()].filter(c=>c?.isTextBased()&&!c.isThread() && c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.ViewChannel)).map(c=>({id:c.id,name:c.name,canSend:c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages),canRead:c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.ReadMessageHistory)})).sort((a,b)=>a.name.localeCompare(b.name));
  }
  async channel(id) {
    const c=this.store.state.config;
    if(!c.guildId||!c.channelIds.includes(id))throw new Error('Channel is not allowed.');
    const channel=await this.ready().channels.fetch(id);
    if(!channel || channel.guildId!==this.store.state.config.guildId || !this.store.state.config.channelIds.includes(id) || !channel.isTextBased())throw new Error('Channel is not allowed.');
    return channel;
  }
  async read(id,count) {
    if(!this.store.state.config.mcpRead)throw new Error('MCP reading is disabled.');
    const channel=await this.channel(id);if(!this.store.state.config.mcpRead)throw new Error('MCP reading is disabled.');const items=await channel.messages.fetch({limit:count});
    return [...items.values()].map(m=>({id:m.id,author:m.author.username,text:m.content,createdAt:m.createdAt.toISOString()}));
  }
  async send(id,text) {
    if(!this.store.state.config.mcpWrite)throw new Error('MCP sending is disabled.');
    const channel=await this.channel(id);if(!this.store.state.config.mcpWrite)throw new Error('MCP sending is disabled.');const m=await channel.send({content:text,allowedMentions:{parse:[],repliedUser:false}});return {id:m.id};
  }
  async onMessage(m) {
    const c=this.store.state.config;
    if(m.author.bot||m.webhookId||!allowed(c,m.guildId,m.channelId,m.author.id))return;
    const parsed=parsePrompt(m.content,this.client.user.id,c.defaultProvider);if(!parsed)return;
    const prefix=`${m.guildId}:${m.channelId}:${m.author.id}:`;
    const safeReply=text=>m.reply({content:text,allowedMentions:{parse:[],repliedUser:false}});
    if(parsed.reset){for(const k of this.busy)if(k.startsWith(prefix))this.cancelled.add(k);for(const k of this.conversations.keys())if(k.startsWith(prefix))this.conversations.delete(k);return safeReply('Your conversation history has been cleared.');}
    if(!parsed.text)return safeReply('Use !chatgpt your question or !claude your question. Use !reset to clear your history.');
    if(parsed.text.length>6000)return safeReply('Please keep questions under 6,000 characters.');
    const now=Date.now(),key=prefix+parsed.provider;
    for(const [k,v] of this.conversations)if(now-v.at>1800000)this.conversations.delete(k);
    for(const [k,v] of this.rates)if(now-v.at>60000)this.rates.delete(k);
    const rate=this.rates.get(m.author.id)||{at:now,count:0};
    if(rate.count>=c.perUserPerMinute||this.active>=3||this.busy.has(key))return safeReply('Please wait before sending another request.');
    if(this.rates.size>=10000)return;
    rate.count++;this.rates.set(m.author.id,rate);
    this.busy.add(key);this.active++;
    const generation=this.generation;
    try {
      if(!this.store.state.secrets[parsed.provider==='openai'?'openaiKey':'anthropicKey'])throw new Error('This provider needs an API key in bot settings.');
      this.store.reserveRequest();
      const history=this.conversations.get(key)?.messages||[];
      const messages=[...history.slice(-8),{role:'user',content:parsed.text}];
      await m.channel.sendTyping().catch(()=>{});
      const response=await this.reply(parsed.provider,c,this.store.state.secrets,messages);
      if(this.cancelled.has(key)||generation!==this.generation||!allowed(this.store.state.config,m.guildId,m.channelId,m.author.id))return;
      if(this.conversations.size>=500)this.conversations.delete(this.conversations.keys().next().value);
      this.conversations.set(key,{at:Date.now(),messages:[...messages,{role:'assistant',content:response.slice(0,6000)}].slice(-8)});
      const label=parsed.provider==='openai'?'ChatGPT':'Claude';
      const chunks=(`${label}\n${response}`).match(/[\s\S]{1,1900}/g)||[];
      for(const chunk of chunks)await safeReply(chunk);
    }catch(e){const safe=/^(OpenAI|Anthropic|Daily AI|This provider|The provider)/.test(e.message)?e.message:'The AI request failed. Check connection and provider settings.';await safeReply(safe);}
    finally {this.active--;this.busy.delete(key);this.cancelled.delete(key);}
  }
}
