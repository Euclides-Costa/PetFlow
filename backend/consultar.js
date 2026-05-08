const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const readline = require('readline');

const db = new sqlite3.Database(path.join(__dirname, 'petflow.db'));

// Função para criar interface de linha de comando
function perguntar(pergunta) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => {
        rl.question(pergunta, (resposta) => {
            rl.close();
            resolve(resposta);
        });
    });
}

console.log('\n========================================');
console.log('📊 CONSULTANDO BANCO DE DADOS - PETFLOW');
console.log('========================================\n');

// Verificar se a tabela de usuários existe
db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='usuarios'", [], async (err, tableUsuarios) => {
    if (err) {
        console.error('❌ Erro ao verificar tabela:', err.message);
        db.close();
        return;
    }

    if (!tableUsuarios) {
        console.log('❌ Tabela "usuarios" não encontrada!');
        console.log('O banco de dados ainda não foi inicializado.');
        console.log('Execute o servidor primeiro para criar as tabelas.');
        db.close();
        return;
    }

    // Listar usuários cadastrados
    db.all("SELECT id, nome, email, data_criacao, ultimo_login FROM usuarios ORDER BY id", [], async (err, usuarios) => {
        if (err) {
            console.error('Erro ao listar usuários:', err);
            db.close();
            return;
        }

        if (!usuarios || usuarios.length === 0) {
            console.log('❌ Nenhum usuário cadastrado!');
            console.log('Faça um cadastro primeiro através do site.');
            db.close();
            return;
        }

        console.log('👤 USUÁRIOS CADASTRADOS:');
        console.log('----------------------------------------');
        usuarios.forEach(user => {
            const dataCriacao = user.data_criacao ? new Date(user.data_criacao).toLocaleString('pt-BR') : 'N/A';
            const ultimoLogin = user.ultimo_login ? new Date(user.ultimo_login).toLocaleString('pt-BR') : 'Nunca';
            console.log(`ID: ${user.id} | ${user.nome}`);
            console.log(`   Email: ${user.email}`);
            console.log(`   Criado em: ${dataCriacao}`);
            console.log(`   Último login: ${ultimoLogin}`);
            console.log('');
        });

        // Perguntar qual usuário consultar
        let usuarioId = usuarios.length === 1 ? usuarios[0].id : null;

        if (usuarios.length > 1) {
            const resposta = await perguntar(`\n🔍 Digite o ID do usuário para consultar (1-${usuarios.length}) ou 't' para todos: `);

            if (resposta.toLowerCase() === 't') {
                usuarioId = 'todos';
            } else {
                usuarioId = parseInt(resposta);
                if (isNaN(usuarioId) || !usuarios.find(u => u.id === usuarioId)) {
                    console.log('❌ ID inválido!');
                    db.close();
                    return;
                }
            }
        }

        // Verificar se a tabela pesos existe
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='pesos'", [], (err, tablePesos) => {
            if (err) {
                console.error('❌ Erro ao verificar tabela pesos:', err.message);
                db.close();
                return;
            }

            if (!tablePesos) {
                console.log('❌ Tabela "pesos" não encontrada!');
                console.log('Nenhum dado de peso foi registrado ainda.');
                db.close();
                return;
            }

            // Construir query baseada no usuário
            let whereClause = '';
            let params = [];

            if (usuarioId !== 'todos') {
                whereClause = 'WHERE usuario_id = ?';
                params = [usuarioId];
            }

            // Total de registros
            db.get(`SELECT COUNT(*) as total FROM pesos ${whereClause}`, params, (err, row) => {
                if (err) {
                    console.error('Erro:', err);
                    db.close();
                    return;
                }

                const totalRegistros = row?.total || 0;

                if (usuarioId !== 'todos') {
                    const usuario = usuarios.find(u => u.id === usuarioId);
                    console.log(`\n📈 Usuário: ${usuario.nome} (${usuario.email})`);
                } else {
                    console.log(`\n📈 TODOS OS USUÁRIOS`);
                }
                console.log(`📊 Total de registros: ${totalRegistros}`);

                if (totalRegistros === 0) {
                    console.log('\n❌ Nenhum registro encontrado para este usuário!');
                    console.log('Aguardando dados do ESP32 ou execute popular-dados.js');
                    console.log('\n========================================\n');
                    db.close();
                    return;
                }

                // Últimos 10 registros
                db.all(`SELECT * FROM pesos ${whereClause} ORDER BY id DESC LIMIT 10`, params, (err, rows) => {
                    if (err) {
                        console.error('Erro:', err);
                        db.close();
                        return;
                    }

                    console.log('\n📋 ÚLTIMOS 10 REGISTROS:');
                    console.log('----------------------------------------');

                    rows.forEach(row => {
                        const data = new Date(row.data).toLocaleString('pt-BR');
                        const usuarioInfo = usuarios.find(u => u.id === row.usuario_id);
                        const usuarioNome = usuarioInfo ? ` (${usuarioInfo.nome.split(' ')[0]})` : '';
                        console.log(`ID: ${row.id.toString().padStart(4)} | Peso: ${row.valor.toFixed(3)} kg | Data: ${data} | Usuário: ${row.usuario_id}${usuarioNome}`);
                    });

                    // Estatísticas gerais
                    const selectStats = `
                        SELECT 
                            MIN(valor) as minimo,
                            MAX(valor) as maximo,
                            AVG(valor) as medio,
                            COUNT(*) as total,
                            SUM(CASE WHEN valor > 0 THEN 1 ELSE 0 END) as positivos,
                            MAX(data) as ultima_data
                        FROM pesos 
                        ${whereClause}
                    `;

                    db.get(selectStats, params, (err, stats) => {
                        if (err) {
                            console.error('Erro:', err);
                            db.close();
                            return;
                        }

                        console.log('\n📊 ESTATÍSTICAS GERAIS:');
                        console.log('----------------------------------------');
                        console.log(`📉 Peso mínimo: ${stats?.minimo?.toFixed(3) || 0} kg`);
                        console.log(`📈 Peso máximo: ${stats?.maximo?.toFixed(3) || 0} kg`);
                        console.log(`📊 Peso médio: ${stats?.medio?.toFixed(3) || 0} kg`);
                        console.log(`✅ Leituras válidas: ${stats?.positivos || 0}`);

                        if (stats?.ultima_data) {
                            const ultimaData = new Date(stats.ultima_data).toLocaleString('pt-BR');
                            console.log(`⏱️  Última leitura: ${ultimaData}`);
                        }

                        // Dados de hoje
                        let whereHoje = whereClause;
                        let paramsHoje = [...params];
                        if (whereHoje) {
                            whereHoje += ' AND DATE(data) = DATE("now")';
                        } else {
                            whereHoje = 'WHERE DATE(data) = DATE("now")';
                        }

                        db.get(`
                            SELECT 
                                COUNT(*) as hoje, 
                                SUM(valor) as total_hoje,
                                COUNT(DISTINCT usuario_id) as usuarios_ativos
                            FROM pesos 
                            ${whereHoje}
                        `, paramsHoje, (err, hoje) => {
                            if (!err && hoje?.hoje > 0) {
                                console.log('\n📅 DADOS DE HOJE:');
                                console.log('----------------------------------------');
                                console.log(`📊 Leituras hoje: ${hoje.hoje}`);
                                if (usuarioId === 'todos') {
                                    console.log(`👥 Usuários ativos hoje: ${hoje.usuarios_ativos}`);
                                }
                                console.log(`🍖 Peso total registrado: ${(hoje.total_hoje || 0).toFixed(3)} kg`);
                            }

                            // Consumo diário estimado
                            if (totalRegistros > 0) {
                                const selectConsumo = `
                                    SELECT 
                                        strftime('%Y-%m-%d', data) as dia,
                                        MAX(valor) - MIN(valor) as consumo_dia
                                    FROM pesos 
                                    ${whereClause}
                                    GROUP BY strftime('%Y-%m-%d', data)
                                    HAVING consumo_dia > 0
                                    ORDER BY dia DESC
                                    LIMIT 30
                                `;

                                db.all(selectConsumo, params, (err, consumos) => {
                                    if (!err && consumos && consumos.length > 0) {
                                        const totalConsumo = consumos.reduce((sum, c) => sum + c.consumo_dia, 0);
                                        const mediaConsumo = totalConsumo / consumos.length;
                                        console.log(`\n🍖 Consumo médio diário estimado (últimos 30 dias): ${mediaConsumo.toFixed(3)} kg (${(mediaConsumo * 1000).toFixed(0)}g)`);
                                    }

                                    console.log('\n========================================\n');
                                    db.close();
                                });
                            } else {
                                console.log('\n========================================\n');
                                db.close();
                            }
                        });
                    });
                });
            });
        });
    });
});