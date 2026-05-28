const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const https = require("https");

require("dotenv").config();

const app = express();

const JWT_SECRET = process.env.JWT_SECRET || "petflow_secret_key_2024";
const JWT_EXPIRES_IN = "7d";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.1-8b-instant";
const GROQ_ENDPOINT = "api.groq.com";

if (!GROQ_API_KEY) console.warn("⚠️  GROQ_API_KEY não definida no .env");

function getDataHoraBrasil() {
    const agora = new Date();
    const utc = agora.getTime() + (agora.getTimezoneOffset() * 60000);
    return new Date(utc + (-3 * 3600000));
}

function formatarDataHoraExibicao(data) {
    const p = n => n.toString().padStart(2, '0');
    return `${p(data.getDate())}/${p(data.getMonth()+1)}/${data.getFullYear()} ${p(data.getHours())}:${p(data.getMinutes())}:${p(data.getSeconds())}`;
}

function formatarDataHoraSQL(data) {
    const p = n => n.toString().padStart(2, '0');
    return `${data.getFullYear()}-${p(data.getMonth()+1)}-${p(data.getDate())} ${p(data.getHours())}:${p(data.getMinutes())}:${p(data.getSeconds())}`;
}

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json());

const frontendPath = path.join(__dirname, '..', 'frontend');
if (!fs.existsSync(frontendPath)) console.error(`❌ Frontend não encontrado: ${frontendPath}`);
else console.log(`✅ Frontend: ${frontendPath}`);
app.use(express.static(frontendPath));

const db = new sqlite3.Database(path.join(__dirname, "petflow.db"));

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha TEXT NOT NULL, raca_animal TEXT, nome_racao TEXT, data_criacao TEXT, ultimo_login TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS pesos (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, valor REAL, data TEXT, FOREIGN KEY (usuario_id) REFERENCES usuarios(id))`);
    db.run(`CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, chave TEXT, valor TEXT, data_atualizacao TEXT, FOREIGN KEY (usuario_id) REFERENCES usuarios(id), UNIQUE(usuario_id, chave))`);
    db.run(`CREATE TABLE IF NOT EXISTS analises_ai (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, tipo_alerta TEXT, mensagem TEXT, sugestao TEXT, previsao_racao_dias INTEGER, metricas_json TEXT, data_criacao TEXT, FOREIGN KEY (usuario_id) REFERENCES usuarios(id))`);
    db.run(`CREATE TABLE IF NOT EXISTS chat_mensagens (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, role TEXT NOT NULL, conteudo TEXT NOT NULL, data TEXT NOT NULL, FOREIGN KEY (usuario_id) REFERENCES usuarios(id))`);
});

function autenticarToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Token não fornecido." });
    try { req.usuario = jwt.verify(token, JWT_SECRET); next(); }
    catch { return res.status(403).json({ error: "Token inválido ou expirado." }); }
}

// ── AUTH ──────────────────────────────────────────────────────
app.post("/api/cadastrar", async (req, res) => {
    const { nome, email, senha, confirmarSenha, raca_animal, nome_racao } = req.body;
    if (!nome || !email || !senha || !confirmarSenha) return res.status(400).json({ error: "Campos obrigatórios ausentes." });
    if (senha !== confirmarSenha) return res.status(400).json({ error: "As senhas não coincidem." });
    if (senha.length < 6) return res.status(400).json({ error: "Senha deve ter no mínimo 6 caracteres." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Email inválido." });
    try {
        const existe = await new Promise(r => db.get("SELECT id FROM usuarios WHERE email=?", [email], (e,row) => r(row)));
        if (existe) return res.status(400).json({ error: "Email já cadastrado." });
        const hash = await bcrypt.hash(senha, 10);
        const agora = formatarDataHoraSQL(getDataHoraBrasil());
        const id = await new Promise((res,rej) => db.run(`INSERT INTO usuarios (nome,email,senha,raca_animal,nome_racao,data_criacao) VALUES(?,?,?,?,?,?)`, [nome,email,hash,raca_animal||null,nome_racao||null,agora], function(e){ if(e)rej(e); else res(this.lastID); }));
        db.run(`INSERT INTO config (usuario_id,chave,valor,data_atualizacao) VALUES (?,'alerta_horas','8',?),(?,'limite_maximo_kg','5',?),(?,'filtro_leituras','5',?)`, [id,agora,id,agora,id,agora]);
        const token = jwt.sign({ id, email, nome }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        res.status(201).json({ success:true, message:"Cadastro realizado!", token, usuario:{id,nome,email,raca_animal:raca_animal||null,nome_racao:nome_racao||null} });
    } catch(e) { console.error(e); res.status(500).json({ error:"Erro interno." }); }
});

app.post("/api/login", async (req, res) => {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ error: "Email e senha obrigatórios." });
    try {
        const u = await new Promise((res,rej) => db.get("SELECT * FROM usuarios WHERE email=?", [email], (e,row) => { if(e)rej(e); else res(row); }));
        if (!u || !(await bcrypt.compare(senha, u.senha))) return res.status(401).json({ error:"Email ou senha inválidos." });
        const agora = formatarDataHoraSQL(getDataHoraBrasil());
        db.run("UPDATE usuarios SET ultimo_login=? WHERE id=?", [agora, u.id]);
        const token = jwt.sign({ id:u.id, email:u.email, nome:u.nome }, JWT_SECRET, { expiresIn:JWT_EXPIRES_IN });
        res.json({ success:true, message:"Login realizado!", token, usuario:{id:u.id,nome:u.nome,email:u.email,raca_animal:u.raca_animal,nome_racao:u.nome_racao} });
    } catch(e) { console.error(e); res.status(500).json({ error:"Erro interno." }); }
});

app.get("/api/verificar", autenticarToken, async (req, res) => {
    const u = await new Promise((res,rej) => db.get("SELECT id,nome,email,raca_animal,nome_racao FROM usuarios WHERE id=?", [req.usuario.id], (e,row) => { if(e)rej(e); else res(row); }));
    if (!u) return res.status(404).json({ error:"Usuário não encontrado." });
    res.json({ valido:true, usuario:u });
});

// ── PESOS ─────────────────────────────────────────────────────
app.post("/peso", autenticarToken, (req, res) => {
    let { peso } = req.body;
    if (peso===undefined||peso===null) return res.status(400).json({ error:"Peso não informado" });
    peso = parseFloat(peso);
    if (peso < 0) return res.json({ status:"ignored", reason:"negative value" });
    if (peso > 10) return res.json({ status:"ignored", reason:"value too high" });
    const agora = getDataHoraBrasil();
    db.run("INSERT INTO pesos (usuario_id,valor,data) VALUES(?,?,?)", [req.usuario.id, peso, formatarDataHoraSQL(agora)],
        function(err) { if(err) return res.status(500).json({ error:err.message }); res.json({ status:"ok", id:this.lastID, peso, timestamp:formatarDataHoraExibicao(agora) }); });
});

app.get("/pesos", autenticarToken, (req, res) => {
    const { limite=500 } = req.query;
    db.all("SELECT * FROM pesos WHERE usuario_id=? AND valor>=0 ORDER BY id DESC LIMIT ?", [req.usuario.id, limite],
        (err,rows) => { if(err) return res.status(500).json({ error:err.message }); res.json(rows); });
});

app.get("/alertas/verificar", autenticarToken, (req, res) => {
    const lim = new Date(getDataHoraBrasil()); lim.setHours(lim.getHours()-8);
    db.get(`SELECT MAX(data) as ultima_vez, MAX(CASE WHEN valor>0.05 THEN data ELSE NULL END) as ultimo_consumo FROM pesos WHERE usuario_id=? AND valor>=0 AND data>=?`,
        [req.usuario.id, formatarDataHoraSQL(lim)], (err,row) => {
            if(err) return res.status(500).json({ error:err.message });
            const alerta = !row?.ultimo_consumo;
            res.json({ alerta, ultimo_consumo:row?.ultimo_consumo||null, ultima_leitura:row?.ultima_vez||null,
                mensagem: alerta ? "⚠️ Seu pet pode não estar se alimentando há mais de 8 horas!" : "✅ Seu pet está se alimentando normalmente" });
        });
});

// ── MÉTRICAS ──────────────────────────────────────────────────
function calcularConsumoPorDia(dados) {
    const d = {};
    for (let i=1;i<dados.length;i++) { const diff=dados[i-1].valor-dados[i].valor; if(diff>0.005){const k=dados[i].data.slice(0,10);d[k]=(d[k]||0)+diff;} }
    return d;
}
function mediaUltimosDias(consumoDiario, dias) {
    const hoje = getDataHoraBrasil(); let total=0,count=0;
    for(let i=0;i<dias;i++){const d=new Date(hoje);d.setDate(d.getDate()-i);const k=formatarDataHoraSQL(d).slice(0,10);if(consumoDiario[k]!==undefined){total+=consumoDiario[k];count++;}}
    return count>0?total/count:0;
}
function consumoUltimas24h(dados) {
    const lim=new Date(getDataHoraBrasil());lim.setHours(lim.getHours()-24);
    const r=dados.filter(d=>new Date(d.data)>=lim);let c=0;
    for(let i=1;i<r.length;i++){const d=r[i-1].valor-r[i].valor;if(d>0.005)c+=d;}return c;
}
function dataUltimaRefeicao(dados) {
    for(let i=dados.length-1;i>0;i--){if(dados[i-1].valor-dados[i].valor>0.01)return dados[i].data;}return null;
}
function identificarHorarioPico(dados) {
    const h=new Array(24).fill(0);
    for(let i=1;i<dados.length;i++){const d=dados[i-1].valor-dados[i].valor;if(d>0.005)h[new Date(dados[i].data).getHours()]+=d;}
    const max=Math.max(...h);if(max===0)return null;
    const hMax=h.indexOf(max);const total=h.reduce((a,b)=>a+b,0);
    return{hora:hMax,percentual:total>0?((max/total)*100).toFixed(0):0};
}
function calcularTendencia(consumoDiario) {
    const dias=Object.keys(consumoDiario).sort();if(dias.length<4)return'insuficiente';
    const rec=dias.slice(-3).map(d=>consumoDiario[d]);const ant=dias.slice(-6,-3).map(d=>consumoDiario[d]);
    if(!rec.length||!ant.length)return'insuficiente';
    const mR=rec.reduce((a,b)=>a+b,0)/rec.length;const mA=ant.reduce((a,b)=>a+b,0)/ant.length;
    if(mA===0)return'insuficiente';const v=((mR-mA)/mA)*100;
    return v>10?'crescente':v<-10?'decrescente':'estavel';
}
function detectarPoteTombado(dados) {
    if(dados.length<5)return false;
    const r=dados.slice(-10);
    for(let i=1;i<r.length-2;i++){
        const q=r[i-1].valor-r[i].valor;const p=r[i-1].valor>0.1?q/r[i-1].valor:0;
        const pos=r.slice(i+1,i+4).map(d=>d.valor);const mp=pos.reduce((a,b)=>a+b,0)/pos.length;
        if(p>0.6&&mp<0.2)return true;
    }return false;
}
function montarMetricas(dados) {
    const ord=[...dados].sort((a,b)=>new Date(a.data)-new Date(b.data));
    const cd=calcularConsumoPorDia(ord);const m7=mediaUltimosDias(cd,7);
    return{
        media_7d:parseFloat(m7.toFixed(3)),media_14d:parseFloat(mediaUltimosDias(cd,14).toFixed(3)),
        media_30d:parseFloat(mediaUltimosDias(cd,30).toFixed(3)),
        consumo_ultimas_24h:parseFloat(consumoUltimas24h(ord).toFixed(3)),
        ultima_refeicao:dataUltimaRefeicao(ord),
        variacao_percentual_7d_vs_30d:parseFloat((()=>{const m30=mediaUltimosDias(cd,30);return m30===0?0:((m7-m30)/m30)*100;})().toFixed(1)),
        horario_pico:identificarHorarioPico(ord),tendencia:calcularTendencia(cd),
        previsao_acabamento_dias:ord.length>0&&m7>0?Math.round(ord[ord.length-1].valor/m7):null,
        pote_tombado:detectarPoteTombado(ord),
        peso_atual:ord.length>0?parseFloat(ord[ord.length-1].valor.toFixed(3)):0,
        total_leituras:dados.length
    };
}

// ── CACHE ─────────────────────────────────────────────────────
const cacheAnalises={};const CACHE_TTL=60*60*1000;
function getCached(id){const e=cacheAnalises[`a_${id}`];if(!e)return null;if(Date.now()-e.t>CACHE_TTL){delete cacheAnalises[`a_${id}`];return null;}return e.d;}
function setCache(id,d){cacheAnalises[`a_${id}`]={d,t:Date.now()};}

// ── GROQ ──────────────────────────────────────────────────────
function chamarGroqAPI(messages, maxTokens=300) {
    return new Promise((resolve,reject)=>{
        if(!GROQ_API_KEY){reject(new Error("Sem chave"));return;}
        const body=JSON.stringify({model:GROQ_MODEL,messages,temperature:0.4,max_tokens:maxTokens});
        const req=https.request({hostname:GROQ_ENDPOINT,path:"/openai/v1/chat/completions",method:"POST",
            headers:{"Authorization":`Bearer ${GROQ_API_KEY}`,"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}},
            (r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{
                try{const j=JSON.parse(d);if(j.error){reject(new Error(j.error.message));return;}resolve(j.choices?.[0]?.message?.content||'');}
                catch(e){reject(e);}
            });});
        req.on('error',reject);req.write(body);req.end();
    });
}

function classificarTipo(m){
    if(m.pote_tombado)return'urgencia';
    if(Math.abs(m.variacao_percentual_7d_vs_30d)>30)return'urgencia';
    if(Math.abs(m.variacao_percentual_7d_vs_30d)>20)return'atencao';
    if(m.previsao_acabamento_dias!==null&&m.previsao_acabamento_dias<=2)return'atencao';
    return'normal';
}
function gerarSugestao(m){
    if(m.pote_tombado)return'Verifique se o pote está posicionado corretamente.';
    if(m.previsao_acabamento_dias!==null&&m.previsao_acabamento_dias<=3)return`Programar compra nos próximos ${m.previsao_acabamento_dias} dias.`;
    if(m.variacao_percentual_7d_vs_30d<-20)return'Observe sintomas como letargia e consulte um veterinário se persistir.';
    return null;
}
function gerarRespostaLocal(m){
    const tipo=classificarTipo(m);let msg='';
    if(m.pote_tombado)msg='🚨 Detectei queda brusca de peso. O pote pode ter sido tombado. Verifique o equipamento.';
    else if(m.variacao_percentual_7d_vs_30d<-20)msg=`⚠️ Consumo caiu ${Math.abs(m.variacao_percentual_7d_vs_30d)}% em relação à média. Pode indicar estresse ou doença.`;
    else if(m.variacao_percentual_7d_vs_30d>30)msg=`📈 Consumo aumentou ${m.variacao_percentual_7d_vs_30d}% acima da média. Verifique se outro animal acessa o pote.`;
    else if(m.previsao_acabamento_dias!==null&&m.previsao_acabamento_dias<=2)msg=`📦 Ração acabando! Dura mais ${m.previsao_acabamento_dias} dia(s). Reponha em breve.`;
    else if(m.horario_pico)msg=`✅ Alimentação normal. Pico de consumo às ${m.horario_pico.hora}h (${m.horario_pico.percentual}% do consumo diário).`;
    else msg=`✅ Tudo certo! Média de ${m.media_7d.toFixed(2)} kg/dia nos últimos 7 dias.`;
    return{tipo_alerta:tipo,mensagem:msg,sugestao:gerarSugestao(m),previsao_racao_dias:m.previsao_acabamento_dias,metricas:m,fonte:'local'};
}

// ── ANÁLISE IA ────────────────────────────────────────────────
app.post('/api/ai/analisar', autenticarToken, async (req,res)=>{
    const uid=req.usuario.id;const force=req.query.force==='true';
    if(!force){const c=getCached(uid);if(c)return res.json({...c,cache:true});}
    try{
        const lim=new Date(getDataHoraBrasil());lim.setDate(lim.getDate()-30);
        const dados=await new Promise((res,rej)=>db.all(`SELECT valor,data FROM pesos WHERE usuario_id=? AND valor>=0 AND data>=? ORDER BY data ASC`,[uid,formatarDataHoraSQL(lim)],(e,r)=>{if(e)rej(e);else res(r);}));
        if(dados.length<10)return res.json({tipo_alerta:'info',mensagem:'📊 Poucos dados ainda. Continue usando o PetFlow por alguns dias!',sugestao:null,previsao_racao_dias:null,metricas:null,cache:false});
        const info=await new Promise(r=>db.get("SELECT raca_animal,nome_racao FROM usuarios WHERE id=?",[uid],(e,row)=>r(row||{})));
        const metricas=montarMetricas(dados);
        let analise;
        if(GROQ_API_KEY){
            const pico=metricas.horario_pico?`Pico às ${metricas.horario_pico.hora}h (${metricas.horario_pico.percentual}%).`:'';
            const var_=metricas.variacao_percentual_7d_vs_30d!==0?`Variação 7d vs 30d: ${metricas.variacao_percentual_7d_vs_30d>0?'+':''}${metricas.variacao_percentual_7d_vs_30d}%.`:'';
            const prompt=`Pet${info.raca_animal?` (${info.raca_animal})`:''}:\n- Pote: ${metricas.peso_atual}kg\n- 24h: ${metricas.consumo_ultimas_24h}kg\n- Média 7d: ${metricas.media_7d}kg/dia\n- Média 30d: ${metricas.media_30d}kg/dia\n- Tendência: ${metricas.tendencia}\n- Previsão: ${metricas.previsao_acabamento_dias??'?'} dias\n${var_}\n${pico}\n${metricas.pote_tombado?'POTE TOMBADO DETECTADO!':''}\nAnálise curta (máx 3 frases): status, alerta se necessário, sugestão.`;
            try{const msg=await chamarGroqAPI([{role:"system",content:"Assistente veterinário especializado em alimentação de pets. Conciso, amigável, máx 3 frases."},{role:"user",content:prompt}],250);
                analise={tipo_alerta:classificarTipo(metricas),mensagem:msg,sugestao:gerarSugestao(metricas),previsao_racao_dias:metricas.previsao_acabamento_dias,metricas,fonte:'groq'};
            }catch(e){console.error("Groq insight:",e.message);analise=gerarRespostaLocal(metricas);}
        }else{analise=gerarRespostaLocal(metricas);}
        const agora=formatarDataHoraSQL(getDataHoraBrasil());
        db.run(`INSERT INTO analises_ai (usuario_id,tipo_alerta,mensagem,sugestao,previsao_racao_dias,metricas_json,data_criacao) VALUES(?,?,?,?,?,?,?)`,[uid,analise.tipo_alerta,analise.mensagem,analise.sugestao||null,analise.previsao_racao_dias||null,JSON.stringify(metricas),agora]);
        setCache(uid,analise);res.json({...analise,cache:false});
    }catch(e){console.error(e);res.status(500).json({error:"Erro ao processar análise."});}
});

app.get('/api/ai/historico', autenticarToken, (req,res)=>{
    db.all(`SELECT id,tipo_alerta,mensagem,sugestao,previsao_racao_dias,data_criacao FROM analises_ai WHERE usuario_id=? ORDER BY data_criacao DESC LIMIT 20`,[req.usuario.id],(e,r)=>{if(e)return res.status(500).json({error:e.message});res.json(r);});
});

// ── CHAT ──────────────────────────────────────────────────────
app.get('/api/chat/historico', autenticarToken, (req,res)=>{
    db.all(`SELECT id,role,conteudo,data FROM chat_mensagens WHERE usuario_id=? ORDER BY id ASC`,[req.usuario.id],(e,r)=>{if(e)return res.status(500).json({error:e.message});res.json(r);});
});

app.delete('/api/chat/historico', autenticarToken, (req,res)=>{
    db.run(`DELETE FROM chat_mensagens WHERE usuario_id=?`,[req.usuario.id],(e)=>{if(e)return res.status(500).json({error:e.message});res.json({success:true});});
});

app.post('/api/chat/mensagem', autenticarToken, async (req,res)=>{
    const uid=req.usuario.id;const{mensagem}=req.body;
    if(!mensagem?.trim())return res.status(400).json({error:"Mensagem vazia."});
    try{
        const info=await new Promise(r=>db.get("SELECT nome,raca_animal,nome_racao FROM usuarios WHERE id=?",[uid],(e,row)=>r(row||{})));
        const lim=new Date(getDataHoraBrasil());lim.setDate(lim.getDate()-30);
        const dados=await new Promise(r=>db.all(`SELECT valor,data FROM pesos WHERE usuario_id=? AND valor>=0 AND data>=? ORDER BY data ASC`,[uid,formatarDataHoraSQL(lim)],(e,r2)=>r(r2||[])));
        let ctx="Sem dados suficientes ainda.";
        if(dados.length>=5){
            const m=montarMetricas(dados);
            const tend={crescente:'📈 crescente',decrescente:'📉 decrescente',estavel:'➡️ estável',insuficiente:'indefinida'}[m.tendencia]||m.tendencia;
            ctx=`- Peso atual no pote: ${m.peso_atual} kg\n- Consumo 24h: ${m.consumo_ultimas_24h} kg\n- Média 7d: ${m.media_7d} kg/dia\n- Média 30d: ${m.media_30d} kg/dia\n- Tendência: ${tend}\n- Variação (7d vs 30d): ${m.variacao_percentual_7d_vs_30d>0?'+':''}${m.variacao_percentual_7d_vs_30d}%\n- Previsão de acabamento: ${m.previsao_acabamento_dias??'?'} dias\n- Horário de pico: ${m.horario_pico?`${m.horario_pico.hora}h (${m.horario_pico.percentual}%)`:'indefinido'}\n- Pote tombado: ${m.pote_tombado?'SIM ⚠️':'não'}\n- Leituras (30d): ${m.total_leituras}`;
        }
        const systemPrompt=`Você é o PetFlow AI, assistente veterinário de monitoramento de alimentação de pets.

TUTOR E PET:
- Tutor: ${info.nome||'Usuário'}
- Raça: ${info.raca_animal||'não informada'}
- Ração: ${info.nome_racao||'não informada'}
- Agora: ${formatarDataHoraExibicao(getDataHoraBrasil())}

DADOS ATUAIS:
${ctx}

REGRAS:
- Responda SEMPRE em português brasileiro
- Seja amigável e use o nome do tutor quando adequado
- Máximo 4 frases por resposta
- Base suas respostas nos dados reais acima
- Sugira veterinário quando pertinente
- Não invente dados
- Emojis com moderação`;

        const hist=await new Promise(r=>db.all(`SELECT role,conteudo FROM chat_mensagens WHERE usuario_id=? ORDER BY id DESC LIMIT 20`,[uid],(e,rows)=>r(rows?rows.reverse():[])));
        const messages=[{role:"system",content:systemPrompt},...hist.map(h=>({role:h.role,content:h.conteudo})),{role:"user",content:mensagem.trim()}];
        const agora=formatarDataHoraSQL(getDataHoraBrasil());
        await new Promise((res,rej)=>db.run(`INSERT INTO chat_mensagens (usuario_id,role,conteudo,data) VALUES(?,'user',?,?)`,[uid,mensagem.trim(),agora],(e)=>{if(e)rej(e);else res();}));
        let resp;
        if(GROQ_API_KEY){
            try{resp=await chamarGroqAPI(messages,400);}
            catch(e){console.error("Groq chat:",e.message);resp=gerarFallbackChat(mensagem,dados.length>=5?montarMetricas(dados):null,info);}
        }else{resp=gerarFallbackChat(mensagem,dados.length>=5?montarMetricas(dados):null,info);}
        const agoraResp=formatarDataHoraSQL(getDataHoraBrasil());
        await new Promise((res,rej)=>db.run(`INSERT INTO chat_mensagens (usuario_id,role,conteudo,data) VALUES(?,'assistant',?,?)`,[uid,resp,agoraResp],(e)=>{if(e)rej(e);else res();}));
        res.json({resposta:resp,fonte:GROQ_API_KEY?'groq':'local',timestamp:agoraResp});
    }catch(e){console.error("Chat:",e);res.status(500).json({error:"Erro ao processar mensagem."});}
});

function gerarFallbackChat(msg,m,info){
    const t=msg.toLowerCase();
    const nome=info?.nome?.split(' ')[0]||'';
    if(t.includes('olá')||t.includes('oi ')||t.includes('^oi')||t==='oi')
        return `Olá${nome?', '+nome:''}! 🐾 Sou o PetFlow AI. Pergunte sobre consumo, horários ou previsão de ração!`;
    if((t.includes('ração')||t.includes('racao'))&&(t.includes('acabar')||t.includes('durar')||t.includes('falt')))
        return m?.previsao_acabamento_dias!=null?`📦 Com o consumo atual, a ração dura mais ${m.previsao_acabamento_dias} dia(s).`:`Sem dados suficientes para prever o término.`;
    if(t.includes('comeu')||t.includes('consumo')||t.includes('comendo'))
        return m?`🍖 Nas últimas 24h: ${m.consumo_ultimas_24h} kg. Média 7 dias: ${m.media_7d} kg/dia.`:`Ainda não há dados suficientes.`;
    if(t.includes('horário')||t.includes('hora')||t.includes('quando'))
        return m?.horario_pico?`⏰ Pico de alimentação às ${m.horario_pico.hora}h (${m.horario_pico.percentual}% do consumo diário).`:`Sem dados de horário ainda.`;
    if(t.includes('peso')||t.includes('pote'))
        return m?`⚖️ Peso atual no pote: ${m.peso_atual} kg.`:`Sem leitura disponível.`;
    return `🤖 Operando sem IA no momento. Peso no pote: ${m?.peso_atual??'?'} kg | Média 7d: ${m?.media_7d??'?'} kg/dia.`;
}

// ── ROTAS ─────────────────────────────────────────────────────
app.get('/login',(req,res)=>res.sendFile(path.join(frontendPath,'login.html')));
app.get('/cadastro',(req,res)=>res.sendFile(path.join(frontendPath,'cadastro.html')));
app.get('/dashboard',(req,res)=>res.sendFile(path.join(frontendPath,'dashboard.html')));
app.get('/api',(req,res)=>res.json({nome:"PetFlow API",versao:"4.1.0",groq_ativo:!!GROQ_API_KEY,horario:formatarDataHoraExibicao(getDataHoraBrasil())}));
app.get('/',(req,res)=>res.redirect('/login'));

const PORT=process.env.PORT||3000;
function getLocalIp(){const{networkInterfaces}=require('os');const nets=networkInterfaces();for(const n of Object.keys(nets))for(const net of nets[n])if(net.family==='IPv4'&&!net.internal)return net.address;return'localhost';}
app.listen(PORT,'0.0.0.0',()=>{
    console.log("\n========================================");
    console.log("🚀 PetFlow Backend v4.1 - Chat com IA");
    console.log("========================================");
    console.log(`🕐 ${formatarDataHoraExibicao(getDataHoraBrasil())}`);
    console.log(`📡 http://${getLocalIp()}:${PORT}`);
    console.log(`🧠 Groq: ${GROQ_API_KEY?'✅ Ativa':'⚠️  Desativada'}`);
    console.log(`💬 Chat ativo no dashboard`);
    console.log("========================================\n");
});