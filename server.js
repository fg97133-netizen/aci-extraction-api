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

// Preview extraction (5 lines) - shared function
async function extractPreview(demand, language) {
  const prompt = `EXTRACTION DEMANDE CLIENT

Demande (${language}):
${demand}

Extrais UNIQUEMENT les 5 premiers produits et fournis UNIQUEMENT ce JSON (sans texte avant/après):
${language === 'EN' ? '\n[IMPORTANT: Traduis TOUS les champs texte en anglais - designation, norme, matiere, finish, notes, etc.]' : ''}

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
    model: 'claude-haiku-5-5',
    max_tokens: 8000,
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

  const textBlock = response.data.content.find(block => block.type === 'text');
  if (!textBlock || !textBlock.text) {
    throw new Error('No text content in Anthropic API response');
  }

  const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('JSON not found in response');
  }

  return JSON.parse(jsonMatch[0]);
}

// Preview endpoint (5 lines preview)
app.post('/api/extract-preview', async (req, res) => {
  try {
    const { demand, fileType, language } = req.body;

    if (!demand || !CLAUDE_API_KEY) {
      return res.status(400).json({ success: false, error: 'Demande manquante ou clé API non configurée' });
    }

    const previewData = await extractPreview(demand, language || 'FR');
    res.json({ success: true, data: previewData });
  } catch (err) {
    console.error('Erreur preview:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Extraction demande client via Claude API
app.post('/api/extract', async (req, res) => {
  try {
    const { demand, language } = req.body;

    if (!demand || !CLAUDE_API_KEY) {
      return res.status(400).json({ success: false, error: 'Demande manquante ou clé API non configurée' });
    }

    const prompt = `EXTRACTION DEMANDE CLIENT - MODE STRICT

Extrais UNIQUEMENT les produits présents dans le fichier/demande fourni.
N'invente AUCUNE donnée. Si une info manque, laisse le champ vide "".
Ne modifie pas, ne complète pas, ne devines pas les données manquantes.

Demande (${language}):
${demand}

Fournis UNIQUEMENT ce JSON (sans texte avant/après):
${language === 'EN' ? '\n[IMPORTANT: Traduis TOUS les champs texte en anglais - designation, norme, matiere, finish, notes, etc.]' : ''}

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
      model: 'claude-haiku-5-5',
      max_tokens: 32000,
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

    console.log('=== ANTHROPIC API RESPONSE (TEXT EXTRACT) ===');
    console.log('Response status:', response.status);

    // Find text block (handle thinking blocks)
    const textBlock = response.data.content.find(block => block.type === 'text');
    if (!textBlock || !textBlock.text) {
      console.error('No text in content blocks');
      return res.status(400).json({ success: false, error: 'No text content in Anthropic API response' });
    }

    const content = textBlock.text;
    console.log('Extracted text content length:', content.length);

    // Extract JSON from response
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

    const prompt = `EXTRACTION DEMANDE CLIENT - MODE STRICT

Extrais UNIQUEMENT les produits présents dans le fichier/demande fourni.
N'invente AUCUNE donnée. Si une info manque, laisse le champ vide "".
Ne modifie pas, ne complète pas, ne devines pas les données manquantes.

Demande (${language}):
${demand}

Fournis UNIQUEMENT ce JSON (sans texte avant/après):
${language === 'EN' ? '\n[IMPORTANT: Traduis TOUS les champs texte en anglais - designation, norme, matiere, finish, notes, etc.]' : ''}

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
      model: 'claude-haiku-5-5',
      max_tokens: 32000,
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

    console.log('=== ANTHROPIC API RESPONSE (PDF EXTRACT) ===');
    console.log('Response status:', response.status);

    // Find text block (handle thinking blocks)
    const textBlock = response.data.content.find(block => block.type === 'text');
    if (!textBlock || !textBlock.text) {
      console.error('No text in content blocks');
      return res.status(400).json({ success: false, error: 'No text content in Anthropic API response' });
    }

    const content = textBlock.text;
    console.log('Extracted text content length:', content.length);

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

// Extraction from Excel file using ExcelJS - READ ALL SHEETS
app.post('/api/extract-excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Aucun fichier fourni' });
    }

    if (!req.file.originalname.match(/\.(xlsx?|csv)$/i)) {
      return res.status(400).json({ success: false, error: 'Le fichier doit être un Excel ou CSV' });
    }

    const language = req.body.language || 'FR';

    // Parse Excel file and convert to text using ExcelJS
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    if (workbook.worksheets.length === 0) {
      return res.status(400).json({ success: false, error: 'Aucune feuille trouvée dans le fichier Excel' });
    }

    // Read ALL worksheets with robust cell access
    let demand = '';
    workbook.worksheets.forEach((worksheet, sheetIndex) => {
      // Add sheet name as separator (except for first sheet)
      if (sheetIndex > 0) {
        demand += '\n--- Feuille: ' + worksheet.name + ' ---\n';
      }

      // Iterate through rows using getRow() for better control
      for (let rowNum = 1; rowNum <= worksheet.rowCount; rowNum++) {
        const row = worksheet.getRow(rowNum);
        const rowData = [];

        // Iterate through columns in this row
        for (let colNum = 1; colNum <= worksheet.columnCount; colNum++) {
          const cell = row.getCell(colNum);
          const cellValue = cell.value !== null && cell.value !== undefined ? String(cell.value).trim() : '';
          rowData.push(cellValue);
        }

        // Join cells with tab and only add non-empty rows
        const rowStr = rowData.join('\t').trim();
        if (rowStr.length > 0) {
          demand += rowStr + '\n';
        }
      }
    });

    if (!demand || demand.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Pas de données trouvées dans le fichier Excel' });
    }

    // Estimate tokens (1 token ≈ 4 characters)
    const estimatedTokens = Math.ceil(demand.length / 4);
    console.log(`Excel file token estimation: ${estimatedTokens} tokens`);

    if (estimatedTokens > 28000) {
      return res.status(413).json({
        success: false,
        error: `Fichier trop volumineux: ${estimatedTokens} tokens estimés (max: 32000 tokens). Réduisez le nombre de feuilles ou les données.`
      });
    }

    if (!CLAUDE_API_KEY) {
      return res.status(400).json({ success: false, error: 'Clé API non configurée' });
    }

    const prompt = `EXTRACTION DEMANDE CLIENT - MODE STRICT

Extrais UNIQUEMENT les produits présents dans le fichier/demande fourni.
N'invente AUCUNE donnée. Si une info manque, laisse le champ vide "".
Ne modifie pas, ne complète pas, ne devines pas les données manquantes.

Demande (${language}):
${demand}

Fournis UNIQUEMENT ce JSON (sans texte avant/après):
${language === 'EN' ? '\n[IMPORTANT: Traduis TOUS les champs texte en anglais - designation, norme, matiere, finish, notes, etc.]' : ''}

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
      model: 'claude-haiku-5-5',
      max_tokens: 32000,
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

    console.log('=== ANTHROPIC API RESPONSE (EXCEL EXTRACT) ===');
    console.log('Response status:', response.status);

    // Find text block (handle thinking blocks)
    const textBlock = response.data.content.find(block => block.type === 'text');
    if (!textBlock || !textBlock.text) {
      console.error('No text in content blocks');
      return res.status(400).json({ success: false, error: 'No text content in Anthropic API response' });
    }

    const content = textBlock.text;
    console.log('Extracted text content length:', content.length);
    console.log('Response content (first 500 chars):', content.substring(0, 500));

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log('ERROR: JSON not found. Full response:', content);
      return res.status(400).json({ success: false, error: 'JSON non trouvé dans la réponse Claude. Check server logs.' });
    }

    const extractedData = JSON.parse(jsonMatch[0]);

    res.json({ success: true, data: extractedData });
  } catch (err) {
    console.error('Erreur extraction Excel:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Export Excel
app.post('/api/export-excel', async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const { data, language } = req.body;

    if (!Array.isArray(data)) {
      return res.status(400).json({ success: false, error: 'Données invalides' });
    }

    // Load template workbook
    const templatePath = path.join(__dirname, 'templates', 'Matrice_consultation_fournisseurs.xlsx');
    const templateWorkbook = new ExcelJS.Workbook();
    await templateWorkbook.xlsx.readFile(templatePath);
    const templateSheet = templateWorkbook.worksheets[0];

    // Create new workbook and copy only rows 1-14 from template
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Demande');

    // Copy rows 1-14 from template exactly
    for (let rowIdx = 1; rowIdx <= 14; rowIdx++) {
      const templateRow = templateSheet.getRow(rowIdx);
      const newRow = worksheet.addRow([]);

      // Copy cell values and formatting
      templateRow.eachCell((cell, colNumber) => {
        const newCell = newRow.getCell(colNumber);
        newCell.value = cell.value;

        // Copy formatting
        if (cell.font) newCell.font = Object.assign({}, cell.font);
        if (cell.fill) newCell.fill = Object.assign({}, cell.fill);
        if (cell.border) newCell.border = Object.assign({}, cell.border);
        if (cell.alignment) newCell.alignment = Object.assign({}, cell.alignment);
        if (cell.numFmt) newCell.numFmt = cell.numFmt;
      });
    }

    // Copy column widths from template
    for (let colIdx = 1; colIdx <= 17; colIdx++) {
      const templateCol = templateSheet.getColumn(colIdx);
      const newCol = worksheet.getColumn(colIdx);
      if (templateCol.width) newCol.width = templateCol.width;
      if (templateCol.hidden) newCol.hidden = templateCol.hidden;
    }

    // Lock all cells in rows 1-14 (template rows)
    for (let rowIdx = 1; rowIdx <= 14; rowIdx++) {
      const row = worksheet.getRow(rowIdx);
      row.eachCell((cell) => {
        cell.protection = { locked: true };
      });
    }

    // Editable columns for supplier: FOB Price(12), CFR Price(13), Delivery time(14), Packing(15), Comments(16)
    const editableColIndices = [11, 12, 13, 14, 15]; // 0-indexed: cols 12-16

    // Data rows - append after row 14
    data.forEach((item) => {
      const row = [
        item.ref_client || '',
        item.code_article || '',
        item.famille || '',
        item.designation || '',
        item.norme || '',
        item.matiere || '',
        item.finish || '',
        item.dimensions || '',
        item.longueur_ml || '',
        item.quantite || '',
        item.unite || '',
        '', // FOB Price - empty for supplier
        '', // CFR Price - empty for supplier
        item.delai || '', // Delivery time
        '', // Packing - empty for supplier
        '', // Comments - empty for supplier
        item.notes || '' // Notes
      ];

      const worksheetRow = worksheet.addRow(row);

      // Apply protection only - no formatting
      worksheetRow.eachCell((cell, colNumber) => {
        const colIdx = colNumber - 1;

        if (editableColIndices.includes(colIdx)) {
          cell.protection = { locked: false }; // Unlock for supplier only
        } else {
          cell.protection = { locked: true }; // Lock everything else
        }
      });
    });

    // Lock sheet with strict protection
    worksheet.protect('123', {
      sheet: true,
      content: true,
      objects: true,
      scenarios: true,
      formatRows: false,
      formatColumns: false,
      formatCells: false,
      insertRows: false,
      insertColumns: false,
      deleteRows: false,
      deleteColumns: false,
      sort: false,
      autoFilter: false,
      pivotTables: false,
      selectLockedCells: false,
      selectUnlockedCells: true
    });

    // Generate Excel buffer
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
