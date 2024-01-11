const express = require('express');
const expressWs = require('express-ws');
const path = require('path');
const session = require('express-session');
const bodyParser = require('body-parser');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');
const qrcodeLib = require('qrcode');
const now = require('performance-now');

// Configuração do servidor Express
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({ secret: 'your-secret-key', resave: true, saveUninitialized: true }));
const wsInstance = expressWs(app);

// Configuração do cliente WhatsApp
const client = new Client({ authStrategy: new LocalAuth() });
const pessoaId = '556195707672@c.us';
//const endpoint = 'http://172.21.20.4:8131/api/v1/ask?modelId=dolphin-mixtral&system=Você é um médico do serviço emergência médica. Capacitado com todo o conhecimento médico necessário para diagnosticar qualquer problema de saúde com base em uma descrição. Suas respostas devem ser: no idioma português do Brasil; curtas e objetivas, de no máximo 60 caracteres; em uma única frase, sem pontuação; informar somente o diagnósitico final e nenhuma informação adicional; sem nenhum prefixo ou sufixo, somente o diagnóstico final.Qualquer pergunta fora do tema diagnóstico de saúde, informe que você não pode responder. Dê um diagnóstico com base na seguinte informação:&maxTokens=1024';

// Inicializar um array para armazenar mensagens e respostas
const messages = [];


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
  wsInstance.getWss().clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify({ ready: true }));
    }
  });
});

client.initialize();

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


// Função de autenticação do usuário
const authenticateUser = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  } else {
    res.redirect('/');
  }
};

// Configurar rota para a página do painel
app.get('/panel', authenticateUser, (req, res) => {
  res.render('panel');
});

// Configurar rota para a página do chatbot
app.get('/chatbot', authenticateUser, (req, res) => {
  res.render('chatbot');
});

// Configurar rota para alternar a conexão do WhatsApp
app.post('/toggle-connection', async (req, res) => {
  try {
    if (client.isConnected()) {
      await client.logout();
    } else {
      await client.initialize();
    }

    res.send({ success: true, isWhatsAppConnected: client.isConnected(), qrCode: client.qrCode });
  } catch (error) {
    console.error('Erro ao alternar a conexão do WhatsApp:', error);
    res.status(500).send({ success: false, message: 'Erro ao alternar a conexão do WhatsApp.' });
  }
});


// Configurar rota para mensagens recebidas
client.on('message', async (message) => {
  if (message.from === pessoaId) {
    console.log('Mensagem recebida de:', message.from);
    console.log('Conteúdo da mensagem:', message.body);

    try {
      const response = await axios.get(`${endpoint}&question=${encodeURIComponent(message.body)}`);
      const resposta = response.data.answer;

      // Adiciona apenas as mensagens recentes ao array com timestamp
      const timestamp = new Date().toISOString();
      messages.push({ from: message.from, body: message.body, timestamp });
      messages.push({ from: 'Chatbot', body: resposta, timestamp });

      client.sendMessage(message.from, resposta);

      console.log('Mensagem enviada para:', message.from);
      console.log('Conteúdo da mensagem enviada:', resposta);

      const recentMessages = messages.slice(-2);
      wsInstance.getWss().clients.forEach((client) => {
        if (client.readyState === client.OPEN) {
          client.send(JSON.stringify({ messages: recentMessages }));
        }
      });
    } catch (error) {
      console.error('Erro ao fazer a solicitação:', error);
    }
  }
});


// url nova timestamp, tempos de resposta usuario e chatobot
app.post('/send-message', async (req, res) => {
  const { message, system } = req.body;

  if (message) {
    try {
      console.log(`Mensagem recebida do usuário: ${message}`);

      

      // Medir o tempo inicial
      const startTime = now();

      // Enviar a mensagem do usuário para o número de telefone do WhatsApp
      const destinatario = '556195707672@c.us';
      await client.sendMessage(destinatario, `Usuário: ${message}`);

      // Construir a URL da API do chatbot
      const apiUrl = 'https://inf.inova.in/api/generate';

      
      const payload = {
        model: 'dolphin-mixtral',
        prompt: message,
        system: system, // "Você é um médico do serviço de emergência médica. Capacitado com todo o conhecimento médico necessário para diagnosticar qualquer problema de saúde com base em uma descrição. Suas respostas devem ser: no idioma português do Brasil, curtas e objetivas, de no máximo 60 caracteres, em uma única frase, sem pontuação; informar somente o diagnósitico final e nenhuma informação adicional; sem nenhum prefixo ou sufixo, somente o diagnóstico final. Qualquer pergunta fora do tema diagnóstico de saúde, informe que você não pode responder. Dê um diagnóstico com base na seguinte informação:",
        stream: false,
        // context: [], // adicionar para manter contexto
      };

      // Fazer a solicitação à API do chatbot
      const beforeEndpointTime = now();
      const response = await axios.post(apiUrl, payload);

      // Medir o tempo final após obter a resposta da API
      const endpointResponseTime = now() - beforeEndpointTime;

      // Calcular tempos de resposta
      const sendMessageTime = beforeEndpointTime - startTime;

      // Verificar se a resposta da API é válida
      if (!response.data || typeof response.data !== 'object' || !response.data.response) {
        throw new Error('Resposta da API inválida: ' + JSON.stringify(response.data));
      }

      // Extrair a resposta do chatbot da resposta da API
      const resposta = response.data.response;
      console.log('Resposta do Chatbot:', resposta);

      // Adicionar a resposta do chatbot ao array de mensagens com timestamp
      const timestampBot = new Date().toISOString();
      const chatbotResponse = {
        from: 'Chatbot',
        body: `${resposta} (Tempo de resposta: ${endpointResponseTime.toFixed(3)} ms)`,
        timestamp: timestampBot,
        responseTime: endpointResponseTime, // Inclui o tempo de resposta no objeto
      };

      // Mostrar no front as mensagens
      messages.push({ from: 'Usuário', body: `${message} (Tempo de resposta: ${sendMessageTime.toFixed(3)} ms)`, timestamp: new Date().toISOString(), responseTime: sendMessageTime });
      messages.push(chatbotResponse);

      // Enviar a resposta do chatbot para o número de telefone do WhatsApp
      await client.sendMessage(destinatario, `Chatbot: ${resposta}`);

      // Enviar as mensagens recentes para todos os clientes conectados via WebSocket
      const recentMessages = [
        { from: 'Usuário', body: `${message} (Tempo de resposta: ${sendMessageTime.toFixed(3)} ms)`, timestamp: new Date().toISOString(), responseTime: sendMessageTime },
        chatbotResponse,
      ];
      wsInstance.getWss().clients.forEach((client) => {
        if (client.readyState === client.OPEN) {
          client.send(JSON.stringify({ messages: recentMessages }));
        }
      });

      console.log(`Tempo para enviar a mensagem do usuário: ${formatTime(sendMessageTime)}`);
      console.log(`Tempo para receber a resposta do endpoint: ${formatTime(endpointResponseTime)}`);

      res.send({ success: true, message: 'Mensagens enviadas com sucesso.' });
    } catch (error) {
      console.error('Erro ao enviar as mensagens:', error);
      res.status(500).send({ success: false, message: 'Erro ao enviar as mensagens.' });
    }
  } else {
    res.status(400).send({ success: false, message: 'A mensagem não pode estar vazia.' });
  }
});

// Função para formatar o tempo em milissegundos para o formato desejado
function formatTime(time) {
  return `${(time / 1000).toFixed(3)} s`;
}




// Configurar rota para o formulário de login
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (username === 'admin' && password === 'admin') {
    req.session.user = { username: 'admin' };
    res.redirect('/panel');
  } else {
    res.redirect('/');
  }
});

// Configurar rota para fazer logoff
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Erro ao fazer logoff:', err);
    }
    res.redirect('/');
  });
});


// Iniciar o servidor
const port = 3000;
app.listen(port, () => {
  console.log(`Servidor está ouvindo na porta ${port}`);
});
