# 🎯 Pitch Predict - MVP Full-Stack

Plataforma para avaliar pitches de negócio usando análise preditiva com machine learning.

## 🚀 Setup Rápido

### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## 📊 Endpoints

### Pitches
- GET `/api/pitches` - Listar todos
- POST `/api/pitches` - Criar novo
- GET `/api/pitches/:id` - Obter um
- PUT `/api/pitches/:id` - Atualizar
- DELETE `/api/pitches/:id` - Deletar

### Predictions
- POST `/api/predictions` - Analisar pitch
- GET `/api/predictions` - Listar todas

### Health
- GET `/api/health` - Status do backend

## 🛠️ Stack

- **Frontend**: React 18 + Vite + Zustand + Axios
- **Backend**: Node.js + Express
- **Database**: Memória (v1)

## 📝 Próximos Passos

- [ ] Conectar banco de dados (MongoDB/PostgreSQL)
- [ ] Autenticação JWT
- [ ] Deploy (Vercel + Railway)
- [ ] Melhorias na UI
- [ ] Integração com IA real

---

**Criado com ❤️ para você aprender full-stack! 🚀**
