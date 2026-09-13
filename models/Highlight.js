const mongoose = require('mongoose');

const highlightSchema = new mongoose.Schema({
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
    pageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Page', required: true },
    sentenceIndex: { type: Number, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Highlight', highlightSchema);