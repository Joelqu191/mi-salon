import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import multer from 'multer';
import webpush from 'web-push';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, {recursive: true});
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, {recursive: true});
const db = new Database(path.join(DATA_DIR, 'salon.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL,
 pin_hash TEXT NOT NULL,
 birthday TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 subject TEXT NOT NULL,
 description TEXT NOT NULL,
 due_date TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 body TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
// Migration compatible with existing databases: no tables or data are deleted.
const columns = db.prepare('PRAGMA table_info(messages)').all().map(x=>x.name);
for(const [column, definition] of Object.entries({attachment_key:'TEXT',attachment_name:'TEXT',attachment_mime:'TEXT',attachment_size:'INTEGER'})) {
 if(!columns.includes(column))db.exec(`ALTER TABLE messages ADD COLUMN ${column} ${definition}`);
}
// Volumen persistente compartido con SQLite: las claves VAPID no cambian al reiniciar.
db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
 endpoint TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 subscription_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
const VAPID_FILE = path.join(DATA_DIR, 'push-vapid-keys.json');
let vapidKeys;
if (fs.existsSync(VAPID_FILE)) {
 vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
} else {
 vapidKeys = webpush.generateVAPIDKeys();
 fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys), {flag:'wx',mode:0o600});
}
const vapidSubject = process.env.VAPID_SUBJECT || 'https://mi-salon-production.up.railway.app';
webpush.setVapidDetails(vapidSubject, vapidKeys.publicKey, vapidKeys.privateKey);
async function notifyOthers(authorId, author, body, messageId) {
 const subscriptions = db.prepare('SELECT endpoint, subscription_json FROM push_subscriptions WHERE user_id != ?').all(authorId);
 const title = author + ' · Mi Salón 💬';
 const text = (body || '📎 Envió una foto o un archivo').slice(0,120);
 await Promise.allSettled(subscriptions.map(async ({endpoint, subscription_json}) => {
  try {
   await webpush.sendNotification(JSON.parse(subscription_json),JSON.stringify({title,body:text,id:messageId,url:'/?chat=1'}),{TTL:3600,urgency:'normal'});
  } catch(err) {
   if(err.statusCode === 404 || err.statusCode === 410){db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint);}
   else console.error('Notificación no entregada:',err.statusCode || err.message);
  }
 }));
}
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const acceptedTypes = {
 '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif',
 '.pdf':'application/pdf','.txt':'text/plain',
 '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 '.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};
const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_FILE_BYTES,files:1,fields:1}});
function validFile(file) {
 const ext=path.extname(file.originalname).toLowerCase(), expected=acceptedTypes[ext];
 if(!expected || file.mimetype!==expected || !file.buffer.length)return false;
 const b=file.buffer;
 if(['.jpg','.jpeg'].includes(ext))return b.length>3&&b[0]===255&&b[1]===216&&b[2]===255;
 if(ext==='.png')return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(ext==='.gif')return ['GIF87a','GIF89a'].includes(b.subarray(0,6).toString('ascii'));
 if(ext==='.webp')return b.subarray(0,4).toString('ascii')==='RIFF'&&b.subarray(8,12).toString('ascii')==='WEBP';
 if(ext==='.pdf')return b.subarray(0,5).toString('ascii')==='%PDF-';
 if(ext==='.txt')return !b.includes(0)&&!b.toString('utf8').includes('\uFFFD');
 return b.subarray(0,4).equals(Buffer.from([80,75,3,4])); // Office OpenXML ZIP container
}
const safeFilename = name=>path.basename(name).replace(/[\x00-\x1f\x7f]/g,'').slice(0,120)||'archivo';
const app = express();
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy: {directives: {defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc:["'self'", 'data:'], connectSrc:["'self'"]}}}));
app.use(express.json({limit:'20kb'}));
app.use(cookieParser());
app.use(express.static(path.join(ROOT,'public')));
app.use('/api', rateLimit({windowMs: 60_000,limit:120,standardHeaders:'draft-7',legacyHeaders:false}));
const authLimit = rateLimit({windowMs:15*60_000, limit:15, standardHeaders:'draft-7',legacyHeaders:false, message:{error:'Demasiados intentos. Intenta más tarde.'}});
const fail = (res, status, message)=>res.status(status).json({error:message});
const hashToken = token=>crypto.createHash('sha256').update(token).digest('hex');
const usernameOk = n=>typeof n==='string' && /^[\p{L}\p{N}_ .-]{2,35}$/u.test(n.trim());
const birthdayOk = s=> {if(typeof s!=='string'||!/^(\d{4})-(\d{2})-(\d{2})$/.test(s))return false;const d=new Date(s+'T12:00:00Z');return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===s&&d.getUTCFullYear()>=1900 && d.getUTCFullYear()<=new Date().getUTCFullYear();};
const dateOk = s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T12:00:00Z');return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10)===s;};
const pinOk = s=>typeof s==='string' && /^\d{6,8}$/.test(s);
const clean = (value,max)=>typeof value==='string'?value.trim().slice(0,max+1):'';
function newSession(res,userId){
 const token=crypto.randomBytes(32).toString('base64url');
 db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(hashToken(token),userId,Date.now()+30*86400000);
 res.cookie('salon_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:30*86400000});
}
function requireUser(req,res,next){
 const token=req.cookies.salon_session;
 if(typeof token!=='string'||!token)return fail(res,401,'Inicia sesión.');
 const row=db.prepare(`SELECT u.id,u.display_name,u.username,u.birthday FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hashToken(token),Date.now());
 if(!row)return fail(res,401,'Tu sesión venció. Inicia de nuevo.');
 req.user=row;next();
}
const currentUser = user=>({id:user.id,name:user.display_name,birthday:user.birthday});
app.post('/api/register',authLimit,(req,res)=>{
 const name=clean(req.body?.name,35), pin=req.body?.pin,birthday=req.body?.birthday;
 if(!usernameOk(name))return fail(res,400,'Nombre de 2 a 35 caracteres; usa letras, números, espacios, punto, guion o guion bajo.');
 if(!pinOk(pin))return fail(res,400,'Usa un PIN de 6 a 8 dígitos.');
 if(!birthdayOk(birthday))return fail(res,400,'Ingresa una fecha de nacimiento válida.');
 try{
  const insert=db.prepare('INSERT INTO users (username,display_name,pin_hash,birthday) VALUES (?,?,?,?)').run(name,name,bcrypt.hashSync(pin,12),birthday);
  newSession(res,insert.lastInsertRowid);
  res.status(201).json({user:{id:insert.lastInsertRowid,name,birthday}});
 }catch(e){if(e.code?.startsWith('SQLITE_CONSTRAINT'))return fail(res,409,'Ese nombre ya está registrado. Usa tu PIN para entrar o elige otro nombre.');throw e;}
});
app.post('/api/login',authLimit,(req,res)=>{
 const name=clean(req.body?.name,35),pin=req.body?.pin;
 if(!usernameOk(name)||!pinOk(pin))return fail(res,400,'Revisa tu nombre y PIN.');
 const user=db.prepare('SELECT * FROM users WHERE username=?').get(name);
 if(!user||!bcrypt.compareSync(pin,user.pin_hash))return fail(res,401,'Nombre o PIN incorrectos.');
 newSession(res,user.id);res.json({user:currentUser(user)});
});
app.post('/api/logout',requireUser,(req,res)=>{db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(req.cookies.salon_session));res.clearCookie('salon_session',{path:'/'});res.json({ok:true});});
app.get('/api/me',requireUser,(req,res)=>res.json({user:currentUser(req.user)}));
app.patch('/api/me',requireUser,(req,res)=>{
 const birthday=req.body?.birthday;
 if(!birthdayOk(birthday))return fail(res,400,'Fecha no válida.');
 db.prepare('UPDATE users SET birthday=? WHERE id=?').run(birthday,req.user.id);
 res.json({user:{...currentUser(req.user),birthday}});
});
app.get('/api/birthdays',requireUser,(req,res)=>{
 const rows=db.prepare('SELECT id,display_name AS name,birthday FROM users').all();
 res.json({birthdays: rows.map(x=>({...x,month:Number(x.birthday.slice(5,7)),day:Number(x.birthday.slice(8,10))})).sort((a,b)=>a.month-b.month||a.day-b.day||a.name.localeCompare(b.name,'es'))});
});
app.get('/api/tasks',requireUser,(req,res)=>res.json({tasks:db.prepare(`SELECT t.id,t.user_id AS author_id,u.display_name AS author,t.subject,t.description,t.due_date,t.created_at,t.updated_at FROM tasks t JOIN users u ON t.user_id=u.id ORDER BY t.due_date ASC,t.id DESC`).all()}));
app.post('/api/tasks',requireUser,(req,res)=>{
 const subject=clean(req.body?.subject,60),description=clean(req.body?.description,800),dueDate=req.body?.due_date;
 if(subject.length<2||subject.length>60||description.length>800||!dateOk(dueDate))return fail(res,400,'Revisa materia, descripción y fecha de entrega.');
 const result=db.prepare('INSERT INTO tasks(user_id,subject,description,due_date) VALUES (?,?,?,?)').run(req.user.id,subject,description,dueDate);
 res.status(201).json({id:result.lastInsertRowid});
});
app.patch('/api/tasks/:id',requireUser,(req,res)=>{
 const subject=clean(req.body?.subject,60),description=clean(req.body?.description,800),dueDate=req.body?.due_date;
 if(subject.length<2||subject.length>60||description.length>800||!dateOk(dueDate))return fail(res,400,'Datos inválidos.');
 const result=db.prepare("UPDATE tasks SET subject=?, description=?, due_date=?,updated_at=datetime('now') WHERE id=? AND user_id=?").run(subject,description,dueDate,req.params.id,req.user.id);
 if(!result.changes)return fail(res,404,'No existe o no es tu publicación.');res.json({ok:true});
});
app.delete('/api/tasks/:id',requireUser,(req,res)=>{
 const result=db.prepare('DELETE FROM tasks WHERE id=? AND user_id=?').run(req.params.id,req.user.id);
 if(!result.changes)return fail(res,404,'No existe o no es tu publicación.');res.json({ok:true});
});
// Cada usuario activa o desactiva sus avisos; no hay permisos especiales.
app.get('/api/push/public-key', requireUser, (req,res) => res.json({publicKey:vapidKeys.publicKey}));
app.post('/api/push/subscribe', requireUser, (req,res) => {
 const sub=req.body?.subscription,endpoint=sub?.endpoint;
 if(typeof endpoint!=='string'||endpoint.length>1600||!endpoint.startsWith('https://')||
    typeof sub?.keys?.auth!=='string'||typeof sub?.keys?.p256dh!=='string'||
    sub.keys.auth.length>256||sub.keys.p256dh.length>256||JSON.stringify(sub).length>3500)
  return fail(res,400,'Suscripción inválida.');
 try{
  const host=new URL(endpoint).hostname;
  const allowed = (host === 'fcm.googleapis.com' || host.endsWith('.fcm.googleapis.com')) || host === 'updates.push.services.mozilla.com' ||
    host === 'push.services.mozilla.com' || host === 'web.push.apple.com' ||
    host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com') ||
    host.endsWith('.windows.com') || host === 'android.googleapis.com';
  if(!allowed)return fail(res,400,'Proveedor de notificaciones no admitido.');
 }catch{return fail(res,400,'URL de notificación inválida.');}
 db.prepare('INSERT INTO push_subscriptions(endpoint,user_id,subscription_json) VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json').run(endpoint,req.user.id,JSON.stringify(sub));
 // Limitar suscripciones por usuario a los 8 dispositivos más recientes.
 db.prepare(`DELETE FROM push_subscriptions WHERE user_id=? AND endpoint NOT IN
  (SELECT endpoint FROM push_subscriptions WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 8)`).run(req.user.id,req.user.id);
 res.json({ok:true});
});
app.post('/api/push/unsubscribe', requireUser, (req,res) => {
 const endpoint=req.body?.endpoint;
 if(typeof endpoint!=='string')return fail(res,400,'Suscripción inválida.');
 db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').run(endpoint,req.user.id);
 res.json({ok:true});
});
app.get('/api/messages',requireUser,(req,res)=>res.json({messages:db.prepare(`SELECT m.id,m.user_id AS author_id,u.display_name AS author,m.body,m.created_at,m.updated_at,m.attachment_name,m.attachment_mime,m.attachment_size FROM (SELECT * FROM messages ORDER BY id DESC LIMIT 150) m JOIN users u ON m.user_id=u.id ORDER BY m.id ASC`).all()}));
// One attachment per message; access requires an authenticated member.
const fileLimit = rateLimit({windowMs:15*60_000,limit:20,standardHeaders:'draft-7',legacyHeaders:false});
app.post('/api/attachments',requireUser,fileLimit,(req,res,next)=>upload.single('file')(req,res,err=>{
 if(err)return fail(res,400,err.code==='LIMIT_FILE_SIZE'?'Máximo 10 MB por archivo.':'No se pudo procesar el archivo.');
 next();
}), (req,res,next)=>{
 const file=req.file,body=clean(req.body?.body,600);
 if(!file)return fail(res,400,'Selecciona un archivo o fotografía.');
 if(body.length>600)return fail(res,400,'Mensaje demasiado largo.');
 if(!validFile(file))return fail(res,400,'Formato no permitido o archivo inválido.');
 const key=crypto.randomUUID(),filename=safeFilename(file.originalname),destination=path.join(UPLOAD_DIR,key);
 try{
  fs.writeFileSync(destination,file.buffer,{flag:'wx',mode:0o600});
  const result=db.prepare('INSERT INTO messages(user_id,body,attachment_key,attachment_name,attachment_mime,attachment_size) VALUES (?,?,?,?,?,?)').run(req.user.id,body,key,filename,acceptedTypes[path.extname(filename).toLowerCase()],file.size);
  res.status(201).json({id:result.lastInsertRowid});
  void notifyOthers(req.user.id,req.user.display_name,body || '📎 '+filename,Number(result.lastInsertRowid));
 }catch(e){try{fs.unlinkSync(destination);}catch{}next(e);}
});
app.get('/api/attachments/:id',requireUser,(req,res)=>{
 const m=db.prepare('SELECT attachment_key,attachment_name,attachment_mime FROM messages WHERE id=?').get(req.params.id);
 if(!m?.attachment_key)return fail(res,404,'Archivo no encontrado.');
 const file=path.join(UPLOAD_DIR,m.attachment_key);
 if(!fs.existsSync(file))return fail(res,404,'El archivo ya no está disponible.');
 const inline=m.attachment_mime.startsWith('image/');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
 res.setHeader('Content-Type',m.attachment_mime);
 res.setHeader('Content-Disposition',`${inline?'inline':'attachment'}; filename="archivo"; filename*=UTF-8''${encodeURIComponent(m.attachment_name)}`);
 res.sendFile(file);
});
app.post('/api/messages',requireUser,(req,res)=>{
 const body=clean(req.body?.body,600);
 if(!body||body.length>600)return fail(res,400,'El mensaje debe tener entre 1 y 600 caracteres.');
 const result=db.prepare('INSERT INTO messages(user_id,body) VALUES (?,?)').run(req.user.id,body);res.status(201).json({id:result.lastInsertRowid});
 void notifyOthers(req.user.id,req.user.display_name,body,Number(result.lastInsertRowid));
});
app.patch('/api/messages/:id',requireUser,(req,res)=>{
 const body=clean(req.body?.body,600);
 if(!body||body.length>600)return fail(res,400,'Mensaje inválido.');
 const result=db.prepare("UPDATE messages SET body=?,updated_at=datetime('now') WHERE id=? AND user_id=?").run(body,req.params.id,req.user.id);
 if(!result.changes)return fail(res,404,'No existe o no es tu mensaje.');res.json({ok:true});
});
app.delete('/api/messages/:id',requireUser,(req,res)=>{
 const own=db.prepare('SELECT attachment_key FROM messages WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
 if(!own)return fail(res,404,'No existe o no es tu mensaje.');
 db.prepare('DELETE FROM messages WHERE id=? AND user_id=?').run(req.params.id,req.user.id);
 if(own.attachment_key){try{fs.unlinkSync(path.join(UPLOAD_DIR,own.attachment_key));}catch(e){console.error('No se pudo eliminar un adjunto:',e.message);}}
 res.json({ok:true});
});
app.use('/api',(req,res)=>fail(res,404,'Ruta no encontrada.'));
app.use((err,req,res,next)=>{console.error(err);fail(res,500,'Error del servidor.');});
const port=Number(process.env.PORT||3000);
app.listen(port,()=>console.log(`Mi Salón listo en http://localhost:${port}`));
