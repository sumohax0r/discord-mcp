import { createHash } from 'node:crypto';
import { InvalidGrantError, InvalidTokenError, InvalidClientMetadataError, InvalidScopeError, InvalidTargetError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { random } from './store.js';
const digest=s=>createHash('sha256').update(s).digest('hex');
const now=()=>Math.floor(Date.now()/1000);
export class OAuthProvider {
  constructor(store,origin) {
    this.store=store;this.origin=origin;this.resource=new URL('/mcp',origin).href;this.pending=new Map();this.codes=new Map();
    if(!store.state.oauth)store.state.oauth={clients:{},access:{},refresh:{}};
    this.clientsStore={getClient:id=>this.db.clients[id],registerClient:async client=>{
      if(Object.keys(this.db.clients).length>=100)throw new InvalidClientMetadataError('Client registry full. Ask the administrator to revoke connections.');
      if(!['none','client_secret_post'].includes(client.token_endpoint_auth_method??'client_secret_post'))throw new InvalidClientMetadataError('Unsupported authentication method.');
      if(!client.redirect_uris?.length || client.redirect_uris.length>5 || client.redirect_uris.some(u=>{try{const x=new URL(u);return x.protocol!=='https:'||x.username||x.password||x.hash;}catch{return true;}}))throw new InvalidClientMetadataError('Exact HTTPS redirect URIs are required.');
      const result={...client,client_id:client.client_id||random(),client_id_issued_at:now()};
      this.db.clients[result.client_id]=result;this.store.save();return result;
    }};
  }
  get db(){return this.store.state.oauth;}
  prune(){for(const map of [this.pending,this.codes])for(const [k,v] of map)if(v.expires<now())map.delete(k);for(const obj of [this.db.access,this.db.refresh])for(const [k,v] of Object.entries(obj))if(v.expiresAt<now())delete obj[k];}
  target(resource){if(resource && resource.href!==this.resource)throw new InvalidTargetError('Wrong resource.');}
  scopes(scopes){const s=scopes?.length?scopes:['discord:read'];if(s.some(x=>!['discord:read','discord:write'].includes(x)))throw new InvalidScopeError('Unknown scope.');return s;}
  async authorize(client,params,res){
    this.prune();this.target(params.resource);this.scopes(params.scopes);
    if(this.pending.size>=100)throw new InvalidGrantError('Too many pending requests.');
    const request=random();this.pending.set(request,{client,params,expires:now()+600});
    res.redirect('/?consent='+encodeURIComponent(request));
  }
  inspect(request){this.prune();const p=this.pending.get(request);if(!p)throw new InvalidGrantError('Authorization request expired.');return {name:p.client.client_name||'MCP client',redirectUri:p.params.redirectUri,scopes:this.scopes(p.params.scopes)};}
  approve(request,allow){
    this.inspect(request);const p=this.pending.get(request);this.pending.delete(request);
    const redirect=new URL(p.params.redirectUri);if(p.params.state)redirect.searchParams.set('state',p.params.state);
    if(!allow){redirect.searchParams.set('error','access_denied');return redirect.href;}
    const code=random();this.codes.set(code,{...p,expires:now()+120});redirect.searchParams.set('code',code);return redirect.href;
  }
  code(client,code){this.prune();const p=this.codes.get(code);if(!p||p.client.client_id!==client.client_id)throw new InvalidGrantError('Invalid authorization code.');return p;}
  async challengeForAuthorizationCode(client,code){return this.code(client,code).params.codeChallenge;}
  async exchangeAuthorizationCode(client,code,verifier,redirectUri,resource){
    this.target(resource);const p=this.code(client,code);
    if(redirectUri!==p.params.redirectUri)throw new InvalidGrantError('Redirect URI mismatch.');
    this.codes.delete(code);return this.issue(client.client_id,this.scopes(p.params.scopes));
  }
  issue(clientId,scopes,family=random()){
    this.prune();const access=random(),refresh=random();
    this.db.access[digest(access)]={clientId,scopes,resource:this.resource,expiresAt:now()+3600,family};
    this.db.refresh[digest(refresh)]={clientId,scopes,resource:this.resource,expiresAt:now()+30*86400,family};
    this.store.save();return {access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:3600,scope:scopes.join(' ')};
  }
  async exchangeRefreshToken(client,token,scopes,resource){
    this.prune();this.target(resource);const p=this.db.refresh[digest(token)];
    if(!p||p.clientId!==client.client_id||p.resource!==this.resource)throw new InvalidGrantError('Invalid refresh token.');
    const requested=scopes??p.scopes;if(requested.some(x=>!p.scopes.includes(x)))throw new InvalidScopeError('Scope escalation denied.');
    delete this.db.refresh[digest(token)];return this.issue(p.clientId,requested,p.family);
  }
  async verifyAccessToken(token){this.prune();const p=this.db.access[digest(token)];if(!p||p.resource!==this.resource)throw new InvalidTokenError('Invalid or expired token.');return {token,clientId:p.clientId,scopes:p.scopes,expiresAt:p.expiresAt,resource:new URL(p.resource)};}
  async revokeToken(client,request){const p=this.db.access[digest(request.token)]??this.db.refresh[digest(request.token)];if(p?.clientId===client.client_id){for(const obj of [this.db.access,this.db.refresh])for(const [k,v] of Object.entries(obj))if(v.family===p.family)delete obj[k];this.store.save();}}
  reset(){this.store.state.oauth={clients:{},access:{},refresh:{}};this.pending.clear();this.codes.clear();this.store.save();}
}
