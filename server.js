const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database('bluebird-polska.db');
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || 'ZMIEN-TO-NA-LOSOWY-TAJNY-KLUCZ';

db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, display_name TEXT NOT NULL,
 badge TEXT NOT NULL, rank TEXT NOT NULL DEFAULT 'Sierżant',
 department TEXT NOT NULL DEFAULT 'Policja', role_group TEXT NOT NULL DEFAULT 'Funkcjonariusz'
);
CREATE TABLE IF NOT EXISTS people (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, dob TEXT DEFAULT '',
 address TEXT DEFAULT '', notes TEXT DEFAULT '', wanted INTEGER DEFAULT 0,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS vehicles (
 id INTEGER PRIMARY KEY AUTOINCREMENT, plate TEXT UNIQUE NOT NULL, model TEXT DEFAULT '',
 color TEXT DEFAULT '', owner TEXT DEFAULT '', status TEXT DEFAULT 'Zarejestrowany', notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS citations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, person TEXT NOT NULL, charge TEXT NOT NULL,
 amount INTEGER NOT NULL DEFAULT 0, officer TEXT NOT NULL, notes TEXT DEFAULT '',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reports (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, type TEXT DEFAULT 'Interwencja',
 officer TEXT NOT NULL, narrative TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS units (
 id INTEGER PRIMARY KEY AUTOINCREMENT, callsign TEXT NOT NULL, officers TEXT DEFAULT '',
 status TEXT DEFAULT 'Dostępny', area TEXT DEFAULT ''
);
`);
db.prepare("UPDATE users SET role_group='Funkcjonariusz' WHERE role_group IS NULL OR role_group!='Komendantura'").run();
if (!db.prepare('SELECT COUNT(*) n FROM users').get().n) {
 db.prepare('INSERT INTO users (username,password_hash,display_name,badge,rank,department) VALUES (?,?,?,?,?,?)')
 .run('admin', bcrypt.hashSync('Policja2026!',10), 'Jan Kowalski', 'P-001', 'Komendant', 'Komenda Główna Policji', 'Komendantura');
 db.prepare('INSERT INTO people (name,dob,address,notes,wanted) VALUES (?,?,?,?,?)')
 .run('Adam Nowak','1998-04-12','Warszawa, Śródmieście','Przykładowy wpis RP',0);
 db.prepare('INSERT INTO vehicles (plate,model,color,owner,status) VALUES (?,?,?,?,?)')
 .run('WPR 12345','BMW Seria 3','Granatowy','Adam Nowak','Zarejestrowany');
 db.prepare('INSERT INTO units (callsign,officers,status,area) VALUES (?,?,?,?)')
 .run('P-12','Jan Kowalski / Piotr Wiśniewski','Dostępny','Warszawa – Śródmieście');
}
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'1mb'}));
app.use(session({secret:SECRET,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000}}));
app.use(express.static(path.join(__dirname,'public')));
const auth=(req,res,next)=>req.session.user?next():res.status(401).json({error:'Brak autoryzacji'});
app.post('/api/login',(req,res)=>{
 const {username,password}=req.body||{};
 const u=db.prepare('SELECT * FROM users WHERE username=?').get(username||'');
 if(!u||!bcrypt.compareSync(password||'',u.password_hash))return res.status(401).json({error:'Nieprawidłowy login lub hasło'});
 req.session.user={id:u.id,username:u.username,displayName:u.display_name,badge:u.badge,rank:u.rank,department:u.department,roleGroup:u.role_group==='Komendantura'?'Komendantura':'Funkcjonariusz'};res.json(req.session.user);
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',(req,res)=>res.json(req.session.user||null));
app.get('/api/summary',auth,(req,res)=>res.json({
 people:db.prepare('SELECT COUNT(*) n FROM people').get().n,
 wanted:db.prepare('SELECT COUNT(*) n FROM people WHERE wanted=1').get().n,
 vehicles:db.prepare('SELECT COUNT(*) n FROM vehicles').get().n,
 reports:db.prepare('SELECT COUNT(*) n FROM reports').get().n,
 units:db.prepare("SELECT COUNT(*) n FROM units WHERE status='Dostępny'").get().n
}));
const resources={
 people:{table:'people',fields:['name','dob','address','notes','wanted'],search:['name','address'],order:'id DESC'},
 vehicles:{table:'vehicles',fields:['plate','model','color','owner','status','notes'],search:['plate','model','owner'],order:'id DESC'},
 citations:{table:'citations',fields:['person','charge','amount','officer','notes'],search:['person','charge','officer'],order:'id DESC'},
 reports:{table:'reports',fields:['title','type','officer','narrative'],search:['title','type','officer','narrative'],order:'id DESC'},
 units:{table:'units',fields:['callsign','officers','status','area'],search:['callsign','officers','area'],order:'id DESC'}
};
for(const [key,c] of Object.entries(resources)){
 app.get('/api/'+key,auth,(req,res)=>{
  const q=String(req.query.q||'').slice(0,100);let sql=`SELECT * FROM ${c.table}`,params=[];
  if(q){sql+=' WHERE '+c.search.map(f=>`${f} LIKE ?`).join(' OR ');params=c.search.map(()=>`%${q}%`)}
  res.json(db.prepare(sql+` ORDER BY ${c.order} LIMIT 250`).all(...params));
 });
 app.post('/api/'+key,auth,(req,res)=>{
  const d=req.body||{},fs=c.fields.filter(f=>d[f]!==undefined);
  if(!fs.length)return res.status(400).json({error:'Brak danych'});
  const vals=fs.map(f=>f==='wanted'?(d[f]?1:0):d[f]);
  try{const info=db.prepare(`INSERT INTO ${c.table} (${fs.join(',')}) VALUES (${fs.map(()=>'?').join(',')})`).run(...vals);
   res.json(db.prepare(`SELECT * FROM ${c.table} WHERE id=?`).get(info.lastInsertRowid));
  }catch(e){res.status(400).json({error:e.message})}
 });
 app.delete('/api/'+key+'/:id',auth,(req,res)=>res.json({usunieto:db.prepare(`DELETE FROM ${c.table} WHERE id=?`).run(Number(req.params.id)).changes}));
}

const adminOnly=(req,res,next)=>req.session.user?.roleGroup==='Komendantura'?next():res.status(403).json({error:'Dostęp tylko dla Komendantury'});
app.get('/api/users',auth,adminOnly,(req,res)=>{
 res.json(db.prepare('SELECT id,username,display_name,badge,rank,department,role_group FROM users ORDER BY id').all());
});
app.post('/api/users',auth,adminOnly,(req,res)=>{
 const d=req.body||{};
 if(!d.username||!d.password||!d.display_name||!d.badge||!d.rank||!d.department||!d.role_group)
  return res.status(400).json({error:'Uzupełnij wszystkie pola'});
 if(String(d.password).length<8)return res.status(400).json({error:'Hasło musi mieć co najmniej 8 znaków'});
 try{
  const assignedGroup=d.role_group==='Komendantura'?'Komendantura':'Funkcjonariusz';
  const info=db.prepare('INSERT INTO users (username,password_hash,display_name,badge,rank,department,role_group) VALUES (?,?,?,?,?,?,?)')
   .run(d.username,bcrypt.hashSync(d.password,10),d.display_name,d.badge,d.rank,d.department,assignedGroup);
  res.json({id:info.lastInsertRowid,ok:true});
 }catch(e){res.status(400).json({error:'Nie można utworzyć konta. Login może być już zajęty.'})}
});
app.delete('/api/users/:id',auth,adminOnly,(req,res)=>{
 const id=Number(req.params.id);
 if(id===req.session.user.id)return res.status(400).json({error:'Nie można usunąć własnego konta'});
 const target=db.prepare('SELECT role_group FROM users WHERE id=?').get(id);
 if(!target)return res.status(404).json({error:'Nie znaleziono konta'});
 if(target.role_group==='Komendantura' && db.prepare("SELECT COUNT(*) n FROM users WHERE role_group='Komendantura'").get().n<=1)
  return res.status(400).json({error:'W systemie musi pozostać co najmniej jedno konto Komendantury'});
 res.json({usunieto:db.prepare('DELETE FROM users WHERE id=?').run(id).changes});
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Bluebird MDT Polska działa: http://localhost:${PORT}`));
