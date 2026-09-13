const mongoose = require('mongoose');

const pageSchema = new mongoose.Schema({
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true, index: true },
    pageNumber: { type: Number, required: true },
    content: { type: String, required: true }
}, { timestamps: true });
pageSchema.index({ content: 'text' });
module.exports = mongoose.model('Page', pageSchema);