// Run locally with the service stopped. Password arrives on stdin, never argv.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,hashPassword} from '../src/store.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let password='';
for await(const chunk of process.stdin){password+=chunk;if(password.length>1024)throw new Error('Password input too long.');}
password=password.replace(/\r?\n$/,'');
const admin=await hashPassword(password);
const store=new Store(process.env.DATA_DIR||path.join(root,'data'));
fs.copyFileSync(store.file,store.file+'.before-password-reset-'+Date.now(),fs.constants.COPYFILE_EXCL);
store.state.admin=admin;
store.save();
password='';
console.log('Administrator password reset. Bot credentials, settings and OAuth grants preserved.');
