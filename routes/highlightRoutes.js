const express = require('express');
const router = express.Router();
const Highlight = require('../models/Highlight');

// Get all highlights for a specific page
router.get('/:pageId', async (req, res) => {
    try {
        const highlights = await Highlight.find({ pageId: req.params.pageId });
        // Return just the array of sentence indices for easy frontend checking
        const indices = highlights.map(h => h.sentenceIndex);
        res.status(200).json(indices);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch highlights' });
    }
});

// Save a new highlight
router.post('/', async (req, res) => {
    try {
        const { bookId, pageId, sentenceIndex } = req.body;

        // Check if it already exists to avoid duplicates
        const existing = await Highlight.findOne({ pageId, sentenceIndex });
        if (existing) return res.status(200).json(existing);

        const newHighlight = new Highlight({ bookId, pageId, sentenceIndex });
        await newHighlight.save();
        res.status(201).json(newHighlight);
    } catch (error) {
        res.status(500).json({ error: 'Failed to save highlight' });
    }
});

// Remove a highlight
router.delete('/', async (req, res) => {
    try {
        const { pageId, sentenceIndex } = req.body;
        await Highlight.findOneAndDelete({ pageId, sentenceIndex });
        res.status(200).json({ message: 'Highlight removed' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to remove highlight' });
    }
});

module.exports = router;