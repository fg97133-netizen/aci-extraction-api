const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ExcelJS = require('exceljs');
const multer = require('multer');
const pdfParse = require('pdf-parse');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// Extraction demande client via Claude API
app.post('/api/extract', async (req, res) => {
  try {
    const { demand, language } = req.body;

    if (!demand || !CLAUDE_API_KEY) {
      return res.status(400).json({ success: false, error: 'Demande manquante ou clé API non configurée' });
    }

    const prompt = `EXTRACTION DEMANDE CLIENT

Demande (${language}):
${demand}

Extrais tous les produits et fournis UNIQUEMENT ce JSON (sans texte avant/après):

[
  {
    "ref_client": "",
    "code_article": "",
    "famille": "TUBES/BOBINES/LAMINE/POUTRELLES/RAB/TOLE/TREILLIS/autre",
    "designation": "",
    "norme": "",
    "matiere": "Acier/Inox/Alu/autre",
    "finish": "",
    "dimensions": "",
    "longueur_ml": "",
    "quantite": "",
    "unite": "T/pcs/ML",
    "delai": "",
    "notes": ""
  }
]`;

    const response = await axios.post(CLAUDE_API_URL, {
      model: 'claude-opus-4-1-20250805',
      max_tokens: 2000,
      messages: [
        { role: 'user', content: prompt }
      ]
    }, {
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });

    const content = response.data.content[0].text;
    
    // Extraire le JSON de la réponse
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return res.status(400).json({ success: false, error: 'JSON non trouvé dans la réponse Claude' });
    }

    const extractedData = JSON.parse(jsonMatch[0]);

    res.json({ success: true, data: extractedData });
  } catch (err) {
    console.error('Erreur extraction:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Extraction from PDF file
app.post('/api/extract-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Aucun fichier fourni' });
    }

    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ success: false, error: 'Le fichier doit être un PDF' });
    }

    const language = req.body.language || 'FR';

    // Parse PDF and extract text
    const pdfData = await pdfParse(req.file.buffer);
    const demand = pdfData.text;

    if (!demand || demand.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Pas de texte trouvé dans le PDF' });
    }

    if (!CLAUDE_API_KEY) {
      return res.status(400).json({ success: false, error: 'Clé API non configurée' });
    }

    const prompt = `EXTRACTION DEMANDE CLIENT

Demande (${language}):
${demand}

Extrais tous les produits et fournis UNIQUEMENT ce JSON (sans texte avant/après):

[
  {
    "ref_client": "",
    "code_article": "",
    "famille": "TUBES/BOBINES/LAMINE/POUTRELLES/RAB/TOLE/TREILLIS/autre",
    "designation": "",
    "norme": "",
    "matiere": "Acier/Inox/Alu/autre",
    "finish": "",
    "dimensions": "",
    "longueur_ml": "",
    "quantite": "",
    "unite": "T/pcs/ML",
    "delai": "",
    "notes": ""
  }
]`;

    const response = await axios.post(CLAUDE_API_URL, {
      model: 'claude-opus-4-1-20250805',
      max_tokens: 2000,
      messages: [
        { role: 'user', content: prompt }
      ]
    }, {
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });

    const content = response.data.content[0].text;

    // Extract JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return res.status(400).json({ success: false, error: 'JSON non trouvé dans la réponse Claude' });
    }

    const extractedData = JSON.parse(jsonMatch[0]);

    res.json({ success: true, data: extractedData });
  } catch (err) {
    console.error('Erreur extraction PDF:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Export Excel
app.post('/api/export-excel', async (req, res) => {
  try {
    const { data, language } = req.body;

    if (!Array.isArray(data)) {
      return res.status(400).json({ success: false, error: 'Données invalides' });
    }

    const headers = language === 'FR'
      ? ['Réf client', 'Code', 'Famille', 'Désignation', 'Norme', 'Matière', 'Finish', 'Dimensions', 'Longueur', 'Quantité', 'Unité', 'Délai', 'Notes']
      : ['Ref', 'Code', 'Family', 'Description', 'Standard', 'Material', 'Finish', 'Dimensions', 'Length', 'Qty', 'Unit', 'Lead time', 'Notes'];

    const keys = ['ref_client', 'code_article', 'famille', 'designation', 'norme', 'matiere', 'finish', 'dimensions', 'longueur_ml', 'quantite', 'unite', 'delai', 'notes'];

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Demande');

    // Header
    worksheet.addRow(headers);
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1EFE8' } };

    // Données
    data.forEach(item => {
      const row = keys.map(key => item[key] || '');
      worksheet.addRow(row);
    });

    // Auto-width
    worksheet.columns.forEach(col => {
      col.width = 15;
    });

    // Générer buffer Excel
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ACI_Demande_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('Erreur export Excel:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
