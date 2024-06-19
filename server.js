const express = require('express');
const expressWs = require('express-ws');
const path = require('path');
const session = require('express-session');
const bodyParser = require('body-parser');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs').promises;
const qrcodeLib = require('qrcode');
const now = require('performance-now');
const puppeteer = require('puppeteer');
const flash = require('connect-flash');
const passport = require('passport');
const initializePassport = require('./passport-config');
const sanitizeHtml = require('sanitize-html'); // Biblioteca para sanitizar dados
const winston = require('winston');

// Configuração do logger com Winston
const logger = winston.createLogger({
  transports: [
    new winston.transports.File({ filename: 'logfile.log' }) // Salva as mensagens de log em um arquivo 'logfile.log'
  ]
});

// Configuração do servidor Express
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
// app.use(session({ secret: 'your-secret-key', resave: true, saveUninitialized: true }));
const wsInstance = expressWs(app);
app.use(express.static('public')); // Para servir arquivos estáticos na pasta public
app.use(express.static('public/img')); // Para servir as images que estão na pasta img

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
// const mysql = require('mysql2/promise');

//const pool = require('./db');


const USERS_PATH = './usuarios.json';

// Banco

const pool = require('./db');

// Middleware para processar dados JSON e URL-encoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: '***********************************************************',
  resave: false,
  saveUninitialized: true
}));

// connect flash
app.use(flash());
initializePassport(passport);


app.use(passport.initialize());
app.use(passport.session());

// Configuração do cliente WhatsApp

client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
      headless: true,
      args: [ '--no-sandbox', '--disable-gpu', ],
  },
  webVersionCache: { type: 'remote', remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html', }
});
const pessoaId = '556195707672@c.us';

//const endpoint = 'http://172.21.20.4:8131/api/v1/ask?modelId=dolphin-mixtral&system=Você é um médico do serviço emergência médica. Capacitado com todo o conhecimento médico necessário para diagnosticar qualquer problema de saúde com base em uma descrição. Suas respostas devem ser: no idioma português do Brasil; curtas e objetivas, de no máximo 60 caracteres; em uma única frase, sem pontuação; informar somente o diagnósitico final e nenhuma informação adicional; sem nenhum prefixo ou sufixo, somente o diagnóstico final.Qualquer pergunta fora do tema diagnóstico de saúde, informe que você não pode responder. Dê um diagnóstico com base na seguinte informação:&maxTokens=1024';

// Inicializar um array para armazenar mensagens e respostas
const messages = [];

// Variavel que recebe true ou false em relação a conexao com o whatsapp
let isWhatsAppConnected = false

// Função para mostrar o código QR no terminal
const showQR = (qrCode) => {
  console.log('Escaneie o QR code com o seu dispositivo móvel para fazer login no WhatsApp Web:');
  qrcode.generate(qrCode, { small: true });

  wsInstance.getWss().clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify({ qrCode: qrCode }));
    }
  });
};

// Configurar eventos do cliente WhatsApp
client.on('qr', showQR);

client.on('ready', () => {
  console.log('WhatsApp Web está pronto e conectado.');
  isWhatsAppConnected = true;
  sendConnectionStatus(); // Chama a função para enviar o status da conexão para o front-end
  wsInstance.getWss().clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify({ ready: true }));
    }
  });
});

client.initialize();

// Espera e reconecta mostra no console o tempo passando
function esperaereconecta(segundos) {
  if (segundos > 0) {
    console.log(`Aguardando ${segundos} segundos para tentar reconectar`);
    setTimeout(() => {
      esperaereconecta(segundos - 1); // Chama a função novamente após 1 segundo
    }, 1000); // 1000 milissegundos = 1 segundo
  } else {
    console.log('Tentando reconectar... de refresh (f5) na página /panel, para o botão "mostrar qr code" ficar disponível ');
    reconnect(); // Executa a reconexão após o tempo de espera
  }
}


// Evento para lidar com a desconexão do WhatsApp
client.on('disconnected', async (reason) => {
  console.log(`WhatsApp desconectado. Motivo: ${reason}.`);
  isWhatsAppConnected = false;

  // Registra a desconexão no arquivo de log
  logger.log({
    level: 'info',
    message: `WhatsApp desconectado. Motivo: ${reason}.`
  });

  try {
    // Inicia a espera de 60 segundos antes de reconectar
    esperaereconecta(60);
    /*
    // Aguardar 60 segundos antes de tentar reconectar
    setTimeout(() => {
        console.log('Aguardando 20 segundos para tentar reconectar');
        reconnect(); // reconectar
    }, 60000); // 60000 milissegundos = 60 segundos */
  } catch (error) {
    console.error('Erro durante o tratamento de desconexão:', error);

  }
});



// tentativa de reconexão

const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectAttempts = 0;
const BACKOFF_INTERVAL = 1000; // Inicialmente, 1 segundo

function reconnect() {
  setTimeout(async () => {
    try {
      await client.initialize();
      console.log('WhatsApp reconectado com sucesso.');
      isWhatsAppConnected = true;
    } catch (reconnectError) {
      console.error('Erro ao reconectar ao WhatsApp:', reconnectError);
      // Aumenta o intervalo de retentativa exponencialmente
      BACKOFF_INTERVAL *= 2;
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        reconnect(); // Tentativa de reconexão novamente
      } else {
        console.error('Máximo de tentativas de reconexão alcançado.');

      }
    }
  }, BACKOFF_INTERVAL);
}


// Função para enviar o status da conexão para o front-end
function sendConnectionStatus() {
  wsInstance.getWss().clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify({
        isWhatsAppConnected: isWhatsAppConnected,
        disconnectButtonDisabled: !isWhatsAppConnected,
        showQrCodeBtnDisabled: isWhatsAppConnected
      }));
    }
  });
}

// Configurar rota para a página inicial
app.get('/', (req, res) => {
  res.render('login');
});

// Configurar WebSocket para a página do chat
app.ws('/chat', (ws, req) => {
  wsInstance.getWss().clients.add(ws);

  const initialData = { messages: messages };
  ws.send(JSON.stringify(initialData));

  ws.on('close', () => {
    wsInstance.getWss().clients.delete(ws);
  });
});

// Configurar rota para obter o QR code
app.get('/qrcode', (req, res) => {
  const sendQRCode = (qrCode) => {
    qrcodeLib.toDataURL(qrCode, (err, url) => {
      if (err) throw err;
      res.send(JSON.stringify({ qrCode: url }));
    });
  };

  // Remover ouvintes antigos antes de adicionar um novo
  client.removeAllListeners('qr');

  if (client.qrCode) {
    sendQRCode(client.qrCode);
  } else {
    const qrListener = (qrCode) => {
      sendQRCode(qrCode);
      client.removeListener('qr', qrListener);
    };

    client.on('qr', qrListener);
  }
});



let remetente;
// Configurar rota para mensagens recebidas
client.on('message', async (message) => {
  try {
    // Armazena o remetente da mensagem em uma variável
    const remetente = message.from;
    console.log('Mensagem recebida de:', remetente);
    console.log('Conteúdo da mensagem:', message.body);

    // Sanitização do conteúdo da mensagem
    const mensagemSanitizada = sanitizeHtml(message.body, {
      allowedTags: [],
      allowedAttributes: {}
    });

    // Adiciona a mensagem recebida ao array de mensagens para enviar ao frontend
    const timestampReceived = new Date().toISOString();
    messages.push({ from: 'Usuário', body: mensagemSanitizada, timestamp: timestampReceived });

    // Verifica se a mensagem é destinada ao pessoaId
    if (message.to === pessoaId) {
      // Envia a mensagem para o endpoint
      console.log('Mensagem destinada ao pessoaId. Enviando para o endpoint...');

      // Construir a URL da API do chatbot com base no payload
      const apiUrl = 'https://inf.inova.in/api/generate';

      // Definir o payload com os parâmetros necessários
      const payload = {
        model: 'dolphin-mixtral',
        prompt: mensagemSanitizada, // Segurança: Usando mensagem sanitizada
        system: 'Você é médico do serviço de emergência médica.Treinado com todo o conhecimento médico necessário para diagnosticar qualquer problema de saúde com base em uma descrição. Suas respostas devem ser: curtas e objetivas, com até 30 caracteres;em uma única frase, sem pontuação;informar apenas o diagnóstico final e nenhuma informação adicional;sem qualquer prefixo ou sufixo, apenas o diagnóstico final.Caso a pergunta fuja do escopo, informe ao usuário: Por favor, forneça detalhes sobre os sintomas que você está enfrentando, incluindo sua intensidade, duração e qualquer fator que os agrave ou alivie. Isso ajudará a fornecer uma resposta mais precisa e útil.Dar um diagnóstico com base no seguinte Informação:',
        stream: false,
      };

      console.log('Enviando solicitação para o endpoint...');

      // Fazer a solicitação à API do chatbot
      const beforeEndpointTime = now();
      const response = await axios.post(apiUrl, payload);
      const endpointResponseTime = now() - beforeEndpointTime;

      console.log('Resposta do endpoint recebida:', response.data);

      // Verificar se a resposta da API é válida
      if (!response.data || typeof response.data !== 'object' || !response.data.response) {
        throw new Error('Resposta da API inválida: ' + JSON.stringify(response.data));
      }

      // Extrair a resposta do chatbot da resposta da API
      const resposta = response.data.response;
      console.log('Resposta do Chatbot:', resposta);

      // Adiciona a mensagem enviada pelo Chatbot ao array de mensagens para enviar ao frontend
      const timestampSent = new Date().toISOString();
      messages.push({ from: 'Chatbot', body: resposta, timestamp: timestampSent });

      // Envia a resposta do chatbot de volta para o número original
      await client.sendMessage(remetente, resposta);

      console.log(`Tempo para receber a resposta do endpoint: ${formatTime(endpointResponseTime)}`);
    } else {
      // Se a mensagem não é destinada ao pessoaId
      console.log('Mensagem não destinada ao pessoaId.');
    }

    // Envia as mensagens recentes para todos os clientes conectados via WebSocket
    const recentMessages = messages.slice(-2);
    wsInstance.getWss().clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify({ messages: recentMessages }));
      }
    });
  } catch (error) {
    console.error('Erro ao processar a mensagem:', error);
  }
});



// Enviar ao destinatário pelo front end (intervenção na conversa pelo operador)
app.post('/send-message', ensureAuthenticated, async (req, res) => {
  const { message } = req.body;

  if (message) {
    try {
      // Sanitização da mensagem recebida
      const mensagemSanitizada = sanitizeHtml(message, {
        allowedTags: [],
        allowedAttributes: {}
      });

      console.log(`Mensagem recebida da intervenção: ${mensagemSanitizada}`);

      // Enviar a mensagem do usuário para o número de telefone do WhatsApp
      // const destinatario = '556195707439@c.us';
      // await client.sendMessage(destinatario, `Intervenção: ${mensagemSanitizada}`);

      // Enviar a mensagem do usuário de volta para o remetente original
      await client.sendMessage(remetente, `Intervenção: ${mensagemSanitizada}`);

      // Mostrar no front as mensagens
      messages.push({ from: 'Intervenção', body: `${mensagemSanitizada}`, timestamp: new Date().toISOString() });

      // Enviar as mensagens recentes para todos os clientes conectados via WebSocket
      const recentMessages = [
        { from: 'Intervenção', body: `${mensagemSanitizada}`, timestamp: new Date().toISOString() }
      ];
      wsInstance.getWss().clients.forEach((client) => {
        if (client.readyState === client.OPEN) {
          client.send(JSON.stringify({ messages: recentMessages }));
        }
      });

      res.send({ success: true, message: 'Mensagens enviadas com sucesso.' });
    } catch (error) {
      console.error('Erro ao enviar as mensagens:', error);
      res.status(500).send({ success: false, message: 'Erro ao enviar as mensagens.' });
    }
  } else {
    res.status(400).send({ success: false, message: 'A mensagem não pode estar vazia.' });
  }
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).send({ success: false, message: 'Usuário não autenticado.' });
}

// Função para formatar o tempo em milissegundos para o formato segundos
function formatTime(time) {
  return `${(time / 1000).toFixed(3)} s`;
}

/*  // funcionando sem mostrar qr code no terminal
app.post('/disconnect-whatsapp', async (req, res) => {
  try {
    // Verificar se o cliente está conectado antes de tentar desconectar
    if (!isWhatsAppConnected) {
      res.send({ success: false, message: 'O cliente não está conectado ao WhatsApp.' });
    } else {
      await client.logout();
      res.send({ success: true, message: 'WhatsApp desconectado com sucesso.' });

      // Exibir mensagem de sucesso
      console.log('Desconectado do WhatsApp com sucesso.');
      isWhatsAppConnected = false;
      sendConnectionStatus();
      // Tentar reconectar após desconectar com sucesso
      try {
        console.log('Tentando reconectar ao WhatsApp...');
        await client.initialize();
        
        console.log('WhatsApp reconectado com sucesso.');
        
        // Atualizar o estado de conexão após a reconexão
        isWhatsAppConnected = true;
        // Enviar o status atualizado da conexão para o front-end
        sendConnectionStatus();
      } catch (reconnectError) {
        console.error('Erro ao reconectar ao WhatsApp:', reconnectError);
        // Lidar com o erro de reconexão
        // Por exemplo, tentar reconectar novamente após um intervalo de tempo
      }
    }
  } catch (error) {
    console.error('Erro ao desconectar do WhatsApp:', error);
    res.status(500).send({ success: false, message: 'Erro ao desconectar do WhatsApp.' });
  }
  sendConnectionStatus();
}); */

app.post('/disconnect-whatsapp', async (req, res) => {
  try {
    // Verificar se o cliente está conectado antes de tentar desconectar
    if (!isWhatsAppConnected) {
      res.send({ success: false, message: 'O cliente não está conectado ao WhatsApp.' });
    } else {
      await client.logout();
      res.send({ success: true, message: 'WhatsApp desconectado com sucesso.' });

      // Exibir mensagem de sucesso
      console.log('Desconectado do WhatsApp com sucesso.');
      isWhatsAppConnected = false;
      sendConnectionStatus();
      // Tentar reconectar após desconectar com sucesso
      try {
        console.log('Tentando reconectar ao WhatsApp...');
        await client.initialize();

        console.log('WhatsApp reconectado com sucesso.');

        // Mostrar o QR code no terminal após a reconexão
        if (client.qrCode) {
          console.log('Escaneie o QR code com o seu dispositivo móvel para fazer login no WhatsApp Web:');
          qrcode.generate(client.qrCode, { small: true });
        }

        // Atualizar o estado de conexão após a reconexão
        isWhatsAppConnected = true;
        // Enviar o status atualizado da conexão para o front-end
        sendConnectionStatus();
      } catch (reconnectError) {
        console.error('Erro ao reconectar ao WhatsApp:', reconnectError);


      }
    }
  } catch (error) {
    console.error('Erro ao desconectar do WhatsApp:', error);
    res.status(500).send({ success: false, message: 'Erro ao desconectar do WhatsApp.' });
  }
  sendConnectionStatus();
});



// Rota para verificar o status da conexão e obter o estado inicial dos botões
app.get('/check-connection', async (req, res) => {
  try {
    // Determinar o status da conexão com o WhatsApp usando a variável isWhatsAppConnected
    const statusMessage = isWhatsAppConnected ? 'Conectado ao WhatsApp' : 'Desconectado do WhatsApp';

    // Responder com o estado dos botões e a mensagem de status em formato JSON
    res.status(200).json({
      isWhatsAppConnected,
      statusMessage,
      disconnectButtonDisabled: !isWhatsAppConnected,
      showQrCodeBtnDisabled: isWhatsAppConnected
    });
  } catch (error) {
    console.error('Erro ao verificar a conexão:', error);
    // Se houver um erro, retornar um status 500 e um objeto JSON indicando a falha
    res.status(500).json({
      isWhatsAppConnected: false,
      statusMessage: 'Erro ao verificar a conexão',
      disconnectButtonDisabled: true,
      showQrCodeBtnDisabled: true
    });
  }
});

// Tratamento de exceções global
process.on('uncaughtException', (err) => {
  console.error('Erro não capturado:', err);
  //reconnect();
}); 

// Rotas de autenticação, login e registro a seguir
//-----------------------------------------------------------------------------//

// Rota para exibir o formulário de login
app.get('/login', (req, res) => {
  res.render('login', { message: req.flash('error') });
});



// Rota de login
app.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.render('login', { message: req.flash('error', 'Nome de usuário ou senha inválidos') });
    }
    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      return res.render('panel', { user }); // Renderizar a view do painel
    });
  })(req, res, next);
});

// Rota para exibir o painel (protegida por autenticação)
app.get('/panel', (req, res) => {
  if (req.isAuthenticated()) {
    res.render('panel', { user: req.user });
  } else {
    res.redirect('/login');
  }
});
app.get('/chatbot', (req, res) => {
  if (req.isAuthenticated()) {
    res.render('chatbot', { user: req.user });
  } else {
    res.redirect('/login');
  }
});

// Rota de logout
app.get('/logout', (req, res, next) => {
  if (req.user) {
    console.log('Usuário desconectado:', req.user.usuario);
  }

  req.logout((err) => {
    if (err) {
      console.error('Erro ao fazer logout:', err);
      return next(err); // Encaminha o erro para o próximo middleware
    }
    req.session.destroy((err) => {
      if (err) {
        console.error('Erro ao destruir sessão:', err);
        return next(err); // Encaminha o erro para o próximo middleware
      }
      res.redirect('/login'); // Redireciona para o painel após o logout
    });
  });
});




// Rota para exibir o formulário de registro
app.get('/registro', (req, res) => {
  res.render('registro');
});

// Rota de registro
app.post('/registro', async (req, res) => {
  const { usuario, senha } = req.body;
  //console.log('Dados de registro:', { usuario, senha });

  try {
    // Verificar se a senha atende aos critérios mínimos
    if (!verificarSenhaForte(senha)) {
      res.status(400).send('A senha deve conter pelo menos 8 caracteres, incluindo letras maiúsculas, minúsculas, números e caracteres especiais.');
      return;
    }

    const [rows] = await pool.query('SELECT * FROM usuarios WHERE usuario = ?', [usuario]);

    if (rows.length > 0) {
      res.status(400).send('Este usuário já existe. Escolha outro nome de usuário.');
    } else {
      const hashedSenha = await bcrypt.hash(senha, 10);
      const novoUsuario = {
        id: uuidv4(),
        usuario: usuario,
        senha: hashedSenha
      };
      console.log('Novo usuário:', novoUsuario.usuario);
      await pool.query('INSERT INTO usuarios SET ?', novoUsuario);
      res.redirect('/');
    }
  } catch (error) {
    console.error('Erro ao processar registro:', error);
    res.status(500).send('Erro interno no servidor');
  }
});

// Função para verificar se a senha é forte o suficiente
function verificarSenhaForte(senha) {
 // A senha deve conter pelo menos 8 caracteres, incluindo letras maiúsculas, minúsculas, números e caracteres especiais.
  const regexSenhaForte = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return regexSenhaForte.test(senha);
}



// Iniciar o servidor
const port = 3000;
app.listen(port, () => {
  console.log(`Servidor está ouvindo na porta ${port}`);
});
