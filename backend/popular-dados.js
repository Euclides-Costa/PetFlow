const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database(path.join(__dirname, "petflow.db"));

// ============================================================
// CONFIGURAÇÕES
// ============================================================

// Consumo diário do animal (em kg)
const CONSUMO_MINIMO_DIARIO = 0.700; // 700g
const CONSUMO_MAXIMO_DIARIO = 1.200; // 1200g

// Peso máximo do comedouro (kg)
const PESO_MAXIMO_COMEDOURO = 3.0;

// Peso mínimo do comedouro (kg) - quando atinge, recarrega
const PESO_MINIMO_RECARGA = 0.300;

// Horários de alimentação típicos
const HORARIOS_ALIMENTACAO = [
    { hora: 6, minuto: 30, nome: "Café da manhã", fator: 0.25 },    // 25% do consumo diário
    { hora: 9, minuto: 0, nome: "Lanche manhã", fator: 0.10 },       // 10% do consumo diário
    { hora: 12, minuto: 0, nome: "Almoço", fator: 0.30 },            // 30% do consumo diário
    { hora: 15, minuto: 0, nome: "Lanche tarde", fator: 0.10 },      // 10% do consumo diário
    { hora: 18, minuto: 0, nome: "Jantar", fator: 0.20 },            // 20% do consumo diário
    { hora: 21, minuto: 0, nome: "Ceia", fator: 0.05 }               // 5% do consumo diário
];

// Usuário padrão para associar os dados (será criado se não existir)
const USUARIO_PADRAO = {
    nome: "Usuário Demo",
    email: "demo@petflow.com",
    senha: "123456",
    raca_animal: "SRD",
    nome_racao: "Ração Premium"
};

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

// Formatar data para SQLite (YYYY-MM-DD HH:MM:SS)
function formatarDataSQL(ano, mes, dia, hora, minuto, segundo = 0) {
    const data = new Date(ano, mes - 1, dia, hora, minuto, segundo);
    const anoFormat = data.getFullYear();
    const mesFormat = (data.getMonth() + 1).toString().padStart(2, '0');
    const diaFormat = data.getDate().toString().padStart(2, '0');
    const horaFormat = data.getHours().toString().padStart(2, '0');
    const minutoFormat = data.getMinutes().toString().padStart(2, '0');
    const segundoFormat = data.getSeconds().toString().padStart(2, '0');
    return `${anoFormat}-${mesFormat}-${diaFormat} ${horaFormat}:${minutoFormat}:${segundoFormat}`;
}

// Adicionar variação aleatória
function variar(valor, percentual) {
    const variacao = valor * (Math.random() - 0.5) * percentual;
    return Math.max(0, valor + variacao);
}

// Calcular consumo diário aleatório (entre 0.7 e 1.2 kg)
function getConsumoDiario() {
    return CONSUMO_MINIMO_DIARIO + Math.random() * (CONSUMO_MAXIMO_DIARIO - CONSUMO_MINIMO_DIARIO);
}

// ============================================================
// CRIAR USUÁRIO DEMO
// ============================================================

async function criarUsuarioDemo() {
    console.log('\n👤 Verificando usuário demo...');

    return new Promise(async (resolve, reject) => {
        // Verificar se usuário já existe
        db.get("SELECT id FROM usuarios WHERE email = ?", [USUARIO_PADRAO.email], async (err, row) => {
            if (err) {
                console.error('Erro ao verificar usuário:', err);
                reject(err);
                return;
            }

            if (row) {
                console.log(`✅ Usuário demo já existe (ID: ${row.id})`);
                resolve(row.id);
                return;
            }

            // Criar usuário demo
            console.log('📝 Criando usuário demo...');
            const senhaHash = await bcrypt.hash(USUARIO_PADRAO.senha, 10);
            const dataCriacao = formatarDataSQL(
                new Date().getFullYear(),
                new Date().getMonth() + 1,
                new Date().getDate(),
                0, 0, 0
            );

            db.run(
                `INSERT INTO usuarios (nome, email, senha, raca_animal, nome_racao, data_criacao)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [USUARIO_PADRAO.nome, USUARIO_PADRAO.email, senhaHash, USUARIO_PADRAO.raca_animal, USUARIO_PADRAO.nome_racao, dataCriacao],
                function(err) {
                    if (err) {
                        console.error('Erro ao criar usuário:', err);
                        reject(err);
                        return;
                    }
                    console.log(`✅ Usuário demo criado (ID: ${this.lastID})`);
                    console.log(`   Email: ${USUARIO_PADRAO.email}`);
                    console.log(`   Senha: ${USUARIO_PADRAO.senha}`);
                    resolve(this.lastID);
                }
            );
        });
    });
}

// ============================================================
// GERAR DADOS PARA UM MÊS ESPECÍFICO
// ============================================================

function gerarDadosMes(ano, mes, diasNoMes, usuario_id) {
    const dados = [];
    let pesoAtualComedouro = PESO_MAXIMO_COMEDOURO * (0.8 + Math.random() * 0.4);

    console.log(`\n📅 Gerando dados para ${mes}/${ano} (${diasNoMes} dias)...`);

    // Variabilidade do consumo ao longo do mês (tendências)
    let tendenciaConsumo = 1.0;

    for (let dia = 1; dia <= diasNoMes; dia++) {
        // Atualizar tendência de consumo (variação diária)
        tendenciaConsumo = variar(tendenciaConsumo, 0.1);
        tendenciaConsumo = Math.max(0.7, Math.min(1.3, tendenciaConsumo));

        // Consumo total do dia (com tendência)
        let consumoTotalDia = getConsumoDiario() * tendenciaConsumo;

        // Adicionar variação de fim de semana (maior consumo)
        const dataAtual = new Date(ano, mes - 1, dia);
        const diaSemana = dataAtual.getDay();
        const isFimSemana = diaSemana === 0 || diaSemana === 6;
        if (isFimSemana) {
            consumoTotalDia *= 1.15; // 15% mais consumo no fim de semana
        }

        // Registrar consumo do dia
        let consumoDia = 0;

        // Registrar recarga do comedouro se necessário
        if (pesoAtualComedouro < PESO_MINIMO_RECARGA) {
            pesoAtualComedouro = PESO_MAXIMO_COMEDOURO * (0.9 + Math.random() * 0.2);
            const horaRecarga = Math.floor(Math.random() * 3) + 22; // Entre 22h e 0h
            const dataRecarga = formatarDataSQL(ano, mes, dia, horaRecarga, Math.floor(Math.random() * 60));
            dados.push({
                usuario_id: usuario_id,
                valor: parseFloat(pesoAtualComedouro.toFixed(3)),
                data: dataRecarga
            });
        }

        // Simular leituras ao longo do dia
        for (const horario of HORARIOS_ALIMENTACAO) {
            if (consumoDia >= consumoTotalDia) break;

            // Quanto vai comer nesta refeição (baseado no fator do horário)
            let consumoRefeicao = consumoTotalDia * horario.fator;

            // Adicionar variação realística
            consumoRefeicao = variar(consumoRefeicao, 0.3);

            // Não pode comer mais do que o disponível no comedouro
            consumoRefeicao = Math.min(consumoRefeicao, pesoAtualComedouro);

            if (consumoRefeicao > 0.01) { // Consumo significativo
                // Peso ANTES de comer
                const pesoAntes = pesoAtualComedouro;
                const dataAntes = formatarDataSQL(ano, mes, dia, horario.hora, horario.minuto - 5);
                dados.push({
                    usuario_id: usuario_id,
                    valor: parseFloat(pesoAntes.toFixed(3)),
                    data: dataAntes
                });

                // Atualizar peso após comer
                pesoAtualComedouro = Math.max(0, pesoAtualComedouro - consumoRefeicao);
                consumoDia += consumoRefeicao;

                // Peso DEPOIS de comer
                const dataDepois = formatarDataSQL(ano, mes, dia, horario.hora, horario.minuto + 5);
                dados.push({
                    usuario_id: usuario_id,
                    valor: parseFloat(pesoAtualComedouro.toFixed(3)),
                    data: dataDepois
                });
            }
        }

        // Adicionar leituras aleatórias extras (simulando verificações)
        const leiturasExtras = Math.floor(Math.random() * 6); // 0 a 5 leituras extras
        for (let i = 0; i < leiturasExtras; i++) {
            const horaExtra = Math.floor(Math.random() * 24);
            const minutoExtra = Math.floor(Math.random() * 60);
            const dataExtra = formatarDataSQL(ano, mes, dia, horaExtra, minutoExtra);

            // Verificar se já não existe leitura muito próxima
            const leituraExistente = dados.some(d =>
                Math.abs(new Date(d.data) - new Date(dataExtra)) < 300000 // 5 minutos
            );

            if (!leituraExistente) {
                dados.push({
                    usuario_id: usuario_id,
                    valor: parseFloat((pesoAtualComedouro + (Math.random() - 0.5) * 0.05).toFixed(3)),
                    data: dataExtra
                });
            }
        }

        // Registrar peso ao final do dia
        const dataFinalDia = formatarDataSQL(ano, mes, dia, 23, 59, 59);
        dados.push({
            usuario_id: usuario_id,
            valor: parseFloat(pesoAtualComedouro.toFixed(3)),
            data: dataFinalDia
        });

        // Mostrar progresso
        if (dia % 5 === 0) {
            const consumoReal = (consumoTotalDia - consumoDia).toFixed(2);
            console.log(`   Dia ${dia}: Consumo ${consumoDia.toFixed(3)}kg / ${consumoTotalDia.toFixed(3)}kg | Peso final: ${pesoAtualComedouro.toFixed(2)}kg`);
        }
    }

    console.log(`   ✅ Gerados ${dados.length} registros para ${mes}/${ano}`);
    return dados;
}

// ============================================================
// INSERIR DADOS NO BANCO
// ============================================================

function inserirDados(dados, mes, ano) {
    return new Promise((resolve, reject) => {
        let inseridos = 0;

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            dados.forEach(dado => {
                db.run("INSERT INTO pesos (usuario_id, valor, data) VALUES (?, ?, ?)",
                    [dado.usuario_id, dado.valor, dado.data],
                    (err) => {
                        if (err) {
                            console.error(`Erro ao inserir: ${err.message}`);
                        } else {
                            inseridos++;
                        }
                    }
                );
            });

            db.run("COMMIT", (err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log(`   💾 Inseridos ${inseridos} registros de ${mes}/${ano}`);
                    resolve(inseridos);
                }
            });
        });
    });
}

// ============================================================
// POPULAR BANCO COMPLETO
// ============================================================

async function popularBancoCompleto() {
    console.log('\n========================================');
    console.log('📊 POPULANDO BANCO COM DADOS MOCADOS');
    console.log('========================================');
    console.log(`🐾 Consumo diário: ${CONSUMO_MINIMO_DIARIO}kg a ${CONSUMO_MAXIMO_DIARIO}kg`);
    console.log(`🍖 Peso máximo do comedouro: ${PESO_MAXIMO_COMEDOURO}kg`);
    console.log('========================================\n');

    // Criar usuário demo
    const usuario_id = await criarUsuarioDemo();
    if (!usuario_id) {
        console.error('❌ Não foi possível criar/obter usuário demo');
        return;
    }

    // Verificar se já existem dados para este usuário
    db.get("SELECT COUNT(*) as total FROM pesos WHERE usuario_id = ?", [usuario_id], async (err, row) => {
        if (err) {
            console.error('Erro ao verificar banco:', err);
            return;
        }

        let limpar = false;

        if (row.total > 0) {
            console.log(`⚠️ Banco já contém ${row.total} registros para o usuário demo.`);
            console.log('Deseja limpar os dados existentes? (s/n)');

            const readline = require('readline').createInterface({
                input: process.stdin,
                output: process.stdout
            });

            readline.question('', (resposta) => {
                readline.close();
                if (resposta.toLowerCase() === 's') {
                    limparEInserir();
                } else {
                    console.log('❌ Operação cancelada.');
                    process.exit(0);
                }
            });
        } else {
            limparEInserir();
        }

        async function limparEInserir() {
            if (limpar || row.total > 0) {
                console.log('\n🧹 Limpando dados existentes...');
                await new Promise((resolve) => {
                    db.run("DELETE FROM pesos WHERE usuario_id = ?", [usuario_id], (err) => {
                        if (err) {
                            console.error('Erro ao limpar:', err);
                        } else {
                            console.log('✅ Dados antigos removidos.\n');
                        }
                        resolve();
                    });
                });
            }

            // Gerar dados para cada mês
            const meses = [
                { nome: "Fevereiro", ano: 2026, mes: 2, dias: 28 },
                { nome: "Março", ano: 2026, mes: 3, dias: 31 },
                { nome: "Abril", ano: 2026, mes: 4, dias: 30 },
                { nome: "Maio", ano: 2026, mes: 5, dias: 31 }
            ];

            let totalRegistros = 0;

            for (const mes of meses) {
                console.log(`\n📊 Processando ${mes.nome}/${mes.ano}...`);
                const dados = gerarDadosMes(mes.ano, mes.mes, mes.dias, usuario_id);
                const inseridos = await inserirDados(dados, mes.nome, mes.ano);
                totalRegistros += inseridos;
            }

            console.log('\n========================================');
            console.log('✅ POPULAÇÃO CONCLUÍDA!');
            console.log('========================================');
            console.log(`📊 Total de registros inseridos: ${totalRegistros}`);
            console.log(`👤 Usuário associado: ${USUARIO_PADRAO.email} (senha: ${USUARIO_PADRAO.senha})`);

            // Mostrar estatísticas finais
            mostrarEstatisticas(usuario_id);
        }
    });
}

// ============================================================
// ESTATÍSTICAS FINAIS
// ============================================================

function mostrarEstatisticas(usuario_id) {
    console.log('\n📊 ESTATÍSTICAS DOS DADOS GERADOS');
    console.log('========================================');

    db.get(`
        SELECT 
            COUNT(*) as total,
            MIN(valor) as minimo,
            MAX(valor) as maximo,
            AVG(valor) as medio
        FROM pesos
        WHERE usuario_id = ?
    `, [usuario_id], (err, stats) => {
        if (err) {
            console.error('Erro:', err);
            return;
        }

        console.log(`📈 Total de registros: ${stats.total}`);
        console.log(`📉 Peso mínimo registrado: ${stats.minimo?.toFixed(3)} kg`);
        console.log(`📈 Peso máximo registrado: ${stats.maximo?.toFixed(3)} kg`);
        console.log(`📊 Peso médio: ${stats.medio?.toFixed(3)} kg`);

        // Consumo por mês
        db.all(`
            SELECT 
                strftime('%m/%Y', data) as mes_ano,
                COUNT(*) as leituras,
                MIN(valor) as minimo,
                MAX(valor) as maximo,
                AVG(valor) as medio
            FROM pesos
            WHERE usuario_id = ?
            GROUP BY strftime('%m/%Y', data)
            ORDER BY data
        `, [usuario_id], (err, meses) => {
            console.log('\n📅 RESUMO POR MÊS:');
            console.log('----------------------------------------');
            meses.forEach(mes => {
                console.log(`${mes.mes_ano}: ${mes.leituras} leituras | Média: ${mes.medio?.toFixed(3)} kg`);
            });

            // Consumo diário estimado
            db.all(`
                SELECT 
                    strftime('%Y-%m-%d', data) as dia,
                    MAX(valor) - MIN(valor) as consumo_dia
                FROM pesos
                WHERE usuario_id = ? AND valor >= 0
                GROUP BY strftime('%Y-%m-%d', data)
                HAVING consumo_dia > 0
            `, [usuario_id], (err, consumos) => {
                if (!err && consumos.length > 0) {
                    const totalConsumo = consumos.reduce((sum, c) => sum + c.consumo_dia, 0);
                    const mediaConsumo = totalConsumo / consumos.length;
                    console.log(`\n🍖 Consumo médio diário estimado: ${mediaConsumo.toFixed(3)} kg (${(mediaConsumo * 1000).toFixed(0)}g)`);
                    console.log(`📊 Faixa esperada: ${CONSUMO_MINIMO_DIARIO * 1000}g - ${CONSUMO_MAXIMO_DIARIO * 1000}g`);
                }

                console.log('\n========================================');
                console.log('🔑 Dados de acesso:');
                console.log(`   Email: ${USUARIO_PADRAO.email}`);
                console.log(`   Senha: ${USUARIO_PADRAO.senha}`);
                console.log('========================================\n');
                db.close();
            });
        });
    });
}

// ============================================================
// EXECUTAR
// ============================================================

console.log('\n🐾 PetFlow - Gerador de Dados Mocados');
console.log('========================================');
console.log('Este script irá gerar dados de consumo para:');
console.log('   📅 Fevereiro/2026 (28 dias)');
console.log('   📅 Março/2026 (31 dias)');
console.log('   📅 Abril/2026 (30 dias)');
console.log('   📅 Maio/2026 (31 dias)');
console.log(`🍖 Consumo diário: ${CONSUMO_MINIMO_DIARIO * 1000}g - ${CONSUMO_MAXIMO_DIARIO * 1000}g`);
console.log('========================================\n');

popularBancoCompleto();