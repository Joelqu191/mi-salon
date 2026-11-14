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

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, {recursive: true});
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
app.get('/api/messages',requireUser,(req,res)=>res.json({messages:db.prepare(`SELECT m.id,m.user_id AS author_id,u.display_name AS author,m.body,m.created_at,m.updated_at FROM (SELECT * FROM messages ORDER BY id DESC LIMIT 150) m JOIN users u ON m.user_id=u.id ORDER BY m.id ASC`).all()}));
app.post('/api/messages',requireUser,(req,res)=>{
 const body=clean(req.body?.body,600);
 if(!body||body.length>600)return fail(res,400,'El mensaje debe tener entre 1 y 600 caracteres.');
 const result=db.prepare('INSERT INTO messages(user_id,body) VALUES (?,?)').run(req.user.id,body);res.status(201).json({id:result.lastInsertRowid});
});
app.patch('/api/messages/:id',requireUser,(req,res)=>{
 const body=clean(req.body?.body,600);
 if(!body||body.length>600)return fail(res,400,'Mensaje inválido.');
 const result=db.prepare("UPDATE messages SET body=?,updated_at=datetime('now') WHERE id=? AND user_id=?").run(body,req.params.id,req.user.id);
 if(!result.changes)return fail(res,404,'No existe o no es tu mensaje.');res.json({ok:true});
});
app.delete('/api/messages/:id',requireUser,(req,res)=>{
 const result=db.prepare('DELETE FROM messages WHERE id=? AND user_id=?').run(req.params.id,req.user.id);
 if(!result.changes)return fail(res,404,'No existe o no es tu mensaje.');res.json({ok:true});
});
app.use('/api',(req,res)=>fail(res,404,'Ruta no encontrada.'));
app.use((err,req,res,next)=>{console.error(err);fail(res,500,'Error del servidor.');});
const port=Number(process.env.PORT||3000);
app.listen(port,()=>console.log(`Mi Salón listo en http://localhost:${port}`));
