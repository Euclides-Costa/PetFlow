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
app.get('/api/chat/historico', autenticarToken, (req, res) => {
    db.all(
        `SELECT id, role, conteudo, data FROM chat_mensagens WHERE usuario_id = ? ORDER BY id ASC`,
        [req.usuario.id],
        (e, r) => { if (e) return res.status(500).json({ error: e.message }); res.json(r); }
    );
});

app.delete('/api/chat/historico', autenticarToken, (req, res) => {
    db.run(`DELETE FROM chat_mensagens WHERE usuario_id = ?`, [req.usuario.id], (e) => {
        if (e) return res.status(500).json({ error: e.message });
        res.json({ success: true });
    });
});

// ── PARSER DE INTENÇÃO ────────────────────────────────────────
// Detecta o tipo de pergunta e resolve datas/períodos mencionados

function detectarIntencao(texto) {
    const t = texto.toLowerCase();
    const intencao = {
        tipo: 'geral',       // geral | consumo_periodo | consumo_hoje | consumo_semana | horario_pico | previsao | peso_atual | comparativo
        dataInicio: null,
        dataFim: null,
        descricaoPeriodo: null
    };

    const agora = getDataHoraBrasil();

    // ── Detectar mês nomeado (ex: "abril", "março de 2025")
    const meses = { janeiro:0, fevereiro:1, março:2, marco:2, abril:3, maio:4, junho:5,
                    julho:6, agosto:7, setembro:8, outubro:9, novembro:10, dezembro:11 };
    for (const [nome, num] of Object.entries(meses)) {
        if (t.includes(nome)) {
            const anoMatch = t.match(/\b(20\d{2})\b/);
            const ano = anoMatch ? parseInt(anoMatch[1]) : agora.getFullYear();
            const inicio = new Date(ano, num, 1, 0, 0, 0);
            const fim = new Date(ano, num + 1, 0, 23, 59, 59);
            // Se o mês inferido está no futuro, assume ano anterior
            if (inicio > agora && !anoMatch) {
                inicio.setFullYear(ano - 1);
                fim.setFullYear(ano - 1);
            }
            intencao.tipo = 'consumo_periodo';
            intencao.dataInicio = inicio;
            intencao.dataFim = fim;
            intencao.descricaoPeriodo = `${nome.charAt(0).toUpperCase() + nome.slice(1)} de ${inicio.getFullYear()}`;
            return intencao;
        }
    }

    // ── "últimos N dias/semanas"
    const matchDias = t.match(/[uú]ltimos?\s+(\d+)\s+dias?/);
    const matchSemanas = t.match(/[uú]ltimas?\s+(\d+)\s+semanas?/);
    if (matchDias) {
        const n = parseInt(matchDias[1]);
        const inicio = new Date(agora); inicio.setDate(inicio.getDate() - n); inicio.setHours(0,0,0,0);
        intencao.tipo = 'consumo_periodo';
        intencao.dataInicio = inicio;
        intencao.dataFim = new Date(agora);
        intencao.descricaoPeriodo = `últimos ${n} dias`;
        return intencao;
    }
    if (matchSemanas) {
        const n = parseInt(matchSemanas[1]);
        const inicio = new Date(agora); inicio.setDate(inicio.getDate() - n * 7); inicio.setHours(0,0,0,0);
        intencao.tipo = 'consumo_periodo';
        intencao.dataInicio = inicio;
        intencao.dataFim = new Date(agora);
        intencao.descricaoPeriodo = `últimas ${n} semana(s)`;
        return intencao;
    }

    // ── "essa semana" / "esta semana"
    if (t.match(/essa\s+semana|esta\s+semana/)) {
        const inicio = new Date(agora);
        inicio.setDate(agora.getDate() - agora.getDay()); inicio.setHours(0,0,0,0);
        intencao.tipo = 'consumo_periodo';
        intencao.dataInicio = inicio;
        intencao.dataFim = new Date(agora);
        intencao.descricaoPeriodo = 'esta semana';
        return intencao;
    }

    // ── "semana passada"
    if (t.match(/semana\s+passada|semana\s+anterior/)) {
        const fimSem = new Date(agora);
        fimSem.setDate(agora.getDate() - agora.getDay() - 1); fimSem.setHours(23,59,59);
        const inicioSem = new Date(fimSem);
        inicioSem.setDate(fimSem.getDate() - 6); inicioSem.setHours(0,0,0,0);
        intencao.tipo = 'consumo_periodo';
        intencao.dataInicio = inicioSem;
        intencao.dataFim = fimSem;
        intencao.descricaoPeriodo = 'semana passada';
        return intencao;
    }

    // ── "mês passado" / "mês anterior"
    if (t.match(/m[eê]s\s+passado|m[eê]s\s+anterior/)) {
        const mesPassado = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
        const fimMes = new Date(agora.getFullYear(), agora.getMonth(), 0, 23, 59, 59);
        intencao.tipo = 'consumo_periodo';
        intencao.dataInicio = mesPassado;
        intencao.dataFim = fimMes;
        intencao.descricaoPeriodo = 'mês passado';
        return intencao;
    }

    // ── "hoje"
    if (t.includes('hoje')) {
        const inicio = new Date(agora); inicio.setHours(0,0,0,0);
        intencao.tipo = 'consumo_periodo';
        intencao.dataInicio = inicio;
        intencao.dataFim = new Date(agora);
        intencao.descricaoPeriodo = 'hoje';
        return intencao;
    }

    // ── "ontem"
    if (t.includes('ontem')) {
        const ontem = new Date(agora); ontem.setDate(ontem.getDate() - 1);
        const inicio = new Date(ontem); inicio.setHours(0,0,0,0);
        const fim = new Date(ontem); fim.setHours(23,59,59);
        intencao.tipo = 'consumo_periodo';
        intencao.dataInicio = inicio;
        intencao.dataFim = fim;
        intencao.descricaoPeriodo = 'ontem';
        return intencao;
    }

    // ── Outros tipos específicos (sem período definido — usa dados gerais)
    if (t.match(/hor[aá]rio|quando\s+come|quando\s+costuma|pico/))
        { intencao.tipo = 'horario_pico'; return intencao; }
    if (t.match(/acab|durar|prever|previs|comprar|repor|estoque/))
        { intencao.tipo = 'previsao'; return intencao; }
    if (t.match(/peso\s+atual|quanto\s+tem|quanto\s+resta|pote\s+agora/))
        { intencao.tipo = 'peso_atual'; return intencao; }
    if (t.match(/compar|diferença|variou|variação|mudou|aument|diminu|caiu|subiu/))
        { intencao.tipo = 'comparativo'; return intencao; }

    return intencao; // tipo = 'geral'
}

// ── BUSCA DE DADOS PRECISA POR PERÍODO ───────────────────────
async function buscarDadosPrecisosParaChat(uid, intencao) {
    // Se a intenção tem um período definido, busca exatamente esse período
    if (intencao.dataInicio && intencao.dataFim) {
        const rows = await new Promise(r =>
            db.all(
                `SELECT valor, data FROM pesos WHERE usuario_id = ? AND valor >= 0 AND data >= ? AND data <= ? ORDER BY data ASC`,
                [uid, formatarDataHoraSQL(intencao.dataInicio), formatarDataHoraSQL(intencao.dataFim)],
                (e, rs) => r(rs || [])
            )
        );

        if (rows.length < 2) return { periodo: intencao.descricaoPeriodo, semDados: true };

        // Calcular consumo real do período (soma de todas as quedas de peso)
        let consumoTotal = 0;
        const consumoPorDia = {};
        for (let i = 1; i < rows.length; i++) {
            const diff = rows[i-1].valor - rows[i].valor;
            if (diff > 0.005) {
                consumoTotal += diff;
                const dia = rows[i].data.slice(0, 10);
                consumoPorDia[dia] = (consumoPorDia[dia] || 0) + diff;
            }
        }

        const diasComDados = Object.keys(consumoPorDia).length;
        const mediaDiaria = diasComDados > 0 ? consumoTotal / diasComDados : 0;

        // Maior e menor dia
        let maiorDia = null, maiorVal = 0, menorDia = null, menorVal = Infinity;
        for (const [dia, val] of Object.entries(consumoPorDia)) {
            if (val > maiorVal) { maiorVal = val; maiorDia = dia; }
            if (val < menorVal) { menorVal = val; menorDia = dia; }
        }

        // Horário de pico no período
        const porHora = new Array(24).fill(0);
        for (let i = 1; i < rows.length; i++) {
            const diff = rows[i-1].valor - rows[i].valor;
            if (diff > 0.005) porHora[new Date(rows[i].data).getHours()] += diff;
        }
        const maxHoraVal = Math.max(...porHora);
        const horaPico = maxHoraVal > 0 ? porHora.indexOf(maxHoraVal) : null;
        const totalHoras = porHora.reduce((a,b) => a+b, 0);
        const picoPct = totalHoras > 0 && horaPico !== null ? ((maxHoraVal/totalHoras)*100).toFixed(0) : null;

        return {
            periodo: intencao.descricaoPeriodo,
            consumoTotal: parseFloat(consumoTotal.toFixed(3)),
            mediaDiaria: parseFloat(mediaDiaria.toFixed(3)),
            diasComDados,
            totalLeituras: rows.length,
            maiorConsumo: maiorDia ? { data: maiorDia, valor: parseFloat(maiorVal.toFixed(3)) } : null,
            menorConsumo: menorDia ? { data: menorDia, valor: parseFloat(menorVal.toFixed(3)) } : null,
            horarioPico: horaPico !== null ? { hora: horaPico, percentual: picoPct } : null,
            pesoInicio: parseFloat(rows[0].valor.toFixed(3)),
            pesoFim: parseFloat(rows[rows.length-1].valor.toFixed(3)),
            semDados: false
        };
    }

    // Sem período definido — retorna métricas gerais dos últimos 30 dias
    const lim = new Date(getDataHoraBrasil()); lim.setDate(lim.getDate() - 30);
    const rows = await new Promise(r =>
        db.all(`SELECT valor, data FROM pesos WHERE usuario_id = ? AND valor >= 0 AND data >= ? ORDER BY data ASC`,
            [uid, formatarDataHoraSQL(lim)], (e, rs) => r(rs || []))
    );
    if (rows.length < 5) return { semDados: true };
    return { metricas: montarMetricas(rows), semDados: false };
}

// ── MONTAR CONTEXTO PRECISO PARA O SYSTEM PROMPT ─────────────
function montarContextoPreciso(dadosBuscados, intencao) {
    if (dadosBuscados.semDados) {
        return `Não há dados suficientes para o período solicitado (${dadosBuscados.periodo || 'geral'}).`;
    }

    // Período específico
    if (dadosBuscados.consumoTotal !== undefined) {
        const d = dadosBuscados;
        let ctx = `DADOS REAIS DO BANCO — Período: ${d.periodo}\n`;
        ctx += `- Consumo total: ${d.consumoTotal} kg\n`;
        ctx += `- Média diária: ${d.mediaDiaria} kg/dia\n`;
        ctx += `- Dias com registro de consumo: ${d.diasComDados}\n`;
        ctx += `- Total de leituras do sensor: ${d.totalLeituras}\n`;
        if (d.maiorConsumo) ctx += `- Maior consumo: ${d.maiorConsumo.valor} kg (dia ${d.maiorConsumo.data})\n`;
        if (d.menorConsumo) ctx += `- Menor consumo: ${d.menorConsumo.valor} kg (dia ${d.menorConsumo.data})\n`;
        if (d.horarioPico) ctx += `- Horário de pico no período: ${d.horarioPico.hora}h (${d.horarioPico.percentual}% do consumo)\n`;
        ctx += `- Peso no pote no início do período: ${d.pesoInicio} kg\n`;
        ctx += `- Peso no pote no final do período: ${d.pesoFim} kg\n`;
        ctx += `\nIMPORTANTE: Use EXATAMENTE esses números na resposta. Não estime nem calcule por conta própria.`;
        return ctx;
    }

    // Dados gerais (métricas dos últimos 30 dias)
    if (dadosBuscados.metricas) {
        const m = dadosBuscados.metricas;
        const tend = { crescente:'📈 crescente', decrescente:'📉 decrescente', estavel:'➡️ estável', insuficiente:'indefinida' }[m.tendencia] || m.tendencia;
        return `DADOS REAIS DO BANCO — Últimos 30 dias
- Peso atual no pote: ${m.peso_atual} kg
- Consumo últimas 24h: ${m.consumo_ultimas_24h} kg
- Média últimos 7 dias: ${m.media_7d} kg/dia
- Média últimos 14 dias: ${m.media_14d} kg/dia
- Média últimos 30 dias: ${m.media_30d} kg/dia
- Tendência: ${tend}
- Variação (7d vs 30d): ${m.variacao_percentual_7d_vs_30d > 0 ? '+' : ''}${m.variacao_percentual_7d_vs_30d}%
- Previsão de acabamento: ${m.previsao_acabamento_dias ?? '?'} dias
- Horário de pico: ${m.horario_pico ? `${m.horario_pico.hora}h (${m.horario_pico.percentual}%)` : 'indefinido'}
- Pote tombado: ${m.pote_tombado ? 'SIM ⚠️' : 'não'}
- Total de leituras (30d): ${m.total_leituras}

IMPORTANTE: Use EXATAMENTE esses números na resposta. Não estime nem calcule por conta própria.`;
    }

    return 'Dados indisponíveis.';
}

// ── FALLBACK SEM API ──────────────────────────────────────────
function gerarFallbackChat(msg, dadosBuscados, info) {
    const nome = info?.nome?.split(' ')[0] || '';
    const t = msg.toLowerCase();

    if (t.match(/^ol[aá]|^oi\b|^bom\s+(dia|tarde|noite)/))
        return `Olá${nome ? ', ' + nome : ''}! 🐾 Sou o PetFlow AI. Pergunte sobre consumo, horários ou previsão de ração!`;

    if (dadosBuscados?.semDados)
        return `Não encontrei dados para esse período. Tente perguntar sobre um intervalo que já tenha leituras registradas.`;

    // Período específico
    if (dadosBuscados?.consumoTotal !== undefined) {
        const d = dadosBuscados;
        return `📊 Em ${d.periodo}: consumo total de ${d.consumoTotal} kg, média de ${d.mediaDiaria} kg/dia em ${d.diasComDados} dias com registro.`;
    }

    // Métricas gerais
    const m = dadosBuscados?.metricas;
    if (!m) return `🤖 Operando sem IA no momento. Sem dados suficientes disponíveis.`;

    if (t.match(/acab|durar|prever|comprar/))
        return m.previsao_acabamento_dias != null ? `📦 Com o consumo atual, a ração dura mais ${m.previsao_acabamento_dias} dia(s).` : `Sem dados suficientes para prever.`;
    if (t.match(/hor[aá]rio|pico|quando\s+come/))
        return m.horario_pico ? `⏰ Pico de alimentação às ${m.horario_pico.hora}h (${m.horario_pico.percentual}% do consumo diário).` : `Sem dados de horário ainda.`;
    if (t.match(/peso|pote/))
        return `⚖️ Peso atual no pote: ${m.peso_atual} kg.`;

    return `🤖 Operando sem IA. Peso no pote: ${m.peso_atual} kg | Média 7d: ${m.media_7d} kg/dia.`;
}

// ── ENDPOINT PRINCIPAL DO CHAT ────────────────────────────────
app.post('/api/chat/mensagem', autenticarToken, async (req, res) => {
    const uid = req.usuario.id;
    const { mensagem } = req.body;
    if (!mensagem?.trim()) return res.status(400).json({ error: "Mensagem vazia." });

    try {
        const info = await new Promise(r =>
            db.get("SELECT nome, raca_animal, nome_racao FROM usuarios WHERE id = ?", [uid], (e, row) => r(row || {}))
        );

        // 1. Detectar intenção da pergunta
        const intencao = detectarIntencao(mensagem);

        // 2. Buscar dados precisos do banco conforme a intenção
        const dadosBuscados = await buscarDadosPrecisosParaChat(uid, intencao);

        // 3. Montar contexto com os dados reais
        const contextoDados = montarContextoPreciso(dadosBuscados, intencao);

        // 4. System prompt com contexto preciso
        const systemPrompt = `Você é o PetFlow AI, assistente veterinário especializado em monitoramento de alimentação de pets.

TUTOR E PET:
- Tutor: ${info.nome || 'Usuário'}
- Raça do animal: ${info.raca_animal || 'não informada'}
- Ração utilizada: ${info.nome_racao || 'não informada'}
- Data e hora atual: ${formatarDataHoraExibicao(getDataHoraBrasil())}

${contextoDados}

REGRAS ABSOLUTAS:
- Responda SEMPRE em português brasileiro
- Use SOMENTE os números fornecidos acima — nunca estime, arredonde diferente ou calcule por conta própria
- Se os dados disserem "consumo total: 2.450 kg", diga exatamente 2.450 kg
- Seja amigável, use o nome do tutor quando fizer sentido
- Máximo 4 frases por resposta
- Sugira veterinário quando pertinente à saúde do animal
- Emojis com moderação
- Para perguntas não relacionadas a dados (ex: "o que é SRD?"), responda normalmente com seu conhecimento veterinário`;

        // 5. Buscar histórico recente do chat
        const hist = await new Promise(r =>
            db.all(`SELECT role, conteudo FROM chat_mensagens WHERE usuario_id = ? ORDER BY id DESC LIMIT 16`,
                [uid], (e, rows) => r(rows ? rows.reverse() : []))
        );

        const messages = [
            { role: "system", content: systemPrompt },
            ...hist.map(h => ({ role: h.role, content: h.conteudo })),
            { role: "user", content: mensagem.trim() }
        ];

        // 6. Salvar mensagem do usuário
        const agora = formatarDataHoraSQL(getDataHoraBrasil());
        await new Promise((res, rej) =>
            db.run(`INSERT INTO chat_mensagens (usuario_id, role, conteudo, data) VALUES (?, 'user', ?, ?)`,
                [uid, mensagem.trim(), agora], e => { if (e) rej(e); else res(); })
        );

        // 7. Chamar Groq ou fallback
        let resp;
        if (GROQ_API_KEY) {
            try {
                resp = await chamarGroqAPI(messages, 450);
            } catch (e) {
                console.error("Groq chat:", e.message);
                resp = gerarFallbackChat(mensagem, dadosBuscados, info);
            }
        } else {
            resp = gerarFallbackChat(mensagem, dadosBuscados, info);
        }

        // 8. Salvar resposta da IA
        const agoraResp = formatarDataHoraSQL(getDataHoraBrasil());
        await new Promise((res, rej) =>
            db.run(`INSERT INTO chat_mensagens (usuario_id, role, conteudo, data) VALUES (?, 'assistant', ?, ?)`,
                [uid, resp, agoraResp], e => { if (e) rej(e); else res(); })
        );

        res.json({ resposta: resp, fonte: GROQ_API_KEY ? 'groq' : 'local', timestamp: agoraResp });

    } catch (e) {
        console.error("Chat:", e);
        res.status(500).json({ error: "Erro ao processar mensagem." });
    }
});

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