const express = require('express');
const router = express.Router();

let pitches = [
  {
    id: 1,
    title: 'AI Marketplace',
    description: 'Plataforma de venda de modelos de IA',
    category: 'SaaS',
    fundingNeeded: 50000,
    teamSize: 3,
    marketSize: 'Grande',
    createdAt: new Date(),
    metrics: {
      innovation: 8,
      marketDemand: 7,
      teamExperience: 6,
      feasibility: 8
    }
  }
];

let nextId = 2;

router.get('/', (req, res) => {
  try {
    res.json({ success: true, count: pitches.length, data: pitches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const pitch = pitches.find(p => p.id === parseInt(req.params.id));
    if (!pitch) return res.status(404).json({ error: 'Pitch não encontrado' });
    res.json({ success: true, data: pitch });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { title, description, category, fundingNeeded, teamSize, marketSize } = req.body;
    if (!title || !description) return res.status(400).json({ error: 'Título e descrição obrigatórios' });

    const newPitch = {
      id: nextId++,
      title,
      description,
      category: category || 'Geral',
      fundingNeeded: fundingNeeded || 0,
      teamSize: teamSize || 1,
      marketSize: marketSize || 'Médio',
      createdAt: new Date(),
      metrics: {
        innovation: Math.floor(Math.random() * 10),
        marketDemand: Math.floor(Math.random() * 10),
        teamExperience: Math.floor(Math.random() * 10),
        feasibility: Math.floor(Math.random() * 10)
      }
    };

    pitches.push(newPitch);
    res.status(201).json({ success: true, message: 'Pitch criado', data: newPitch });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const pitchIndex = pitches.findIndex(p => p.id === parseInt(req.params.id));
    if (pitchIndex === -1) return res.status(404).json({ error: 'Pitch não encontrado' });

    pitches[pitchIndex] = {
      ...pitches[pitchIndex],
      ...req.body,
      id: pitches[pitchIndex].id,
      createdAt: pitches[pitchIndex].createdAt
    };

    res.json({ success: true, message: 'Pitch atualizado', data: pitches[pitchIndex] });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const pitchIndex = pitches.findIndex(p => p.id === parseInt(req.params.id));
    if (pitchIndex === -1) return res.status(404).json({ error: 'Pitch não encontrado' });

    const deletedPitch = pitches.splice(pitchIndex, 1);
    res.json({ success: true, message: 'Pitch removido', data: deletedPitch[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
