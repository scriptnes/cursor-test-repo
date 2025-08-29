const db = require('../db/models');
const VerbsDBApi = require('../db/api/verbs');
const processFile = require('../middlewares/upload');
const ValidationError = require('./notifications/errors/validation');
const csv = require('csv-parser');
const axios = require('axios');
const config = require('../config');
const stream = require('stream');
const iconv = require('iconv-lite');

module.exports = class VerbsService {
  static async create(data, currentUser) {
    const transaction = await db.sequelize.transaction();
    try {
      await VerbsDBApi.create(data, {
        currentUser,
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  static async bulkImport(req, res, _sendInvitationEmails = true, host) {
    const transaction = await db.sequelize.transaction();
    try {
      // 1) Изтегляме файла от multipart (оставяме res, защото processFile го иска)
      await processFile(req, res);

      // 2) Подготвяме текст от буфера + интелигентен decode
      const buf = Buffer.isBuffer(req.file.buffer)
        ? req.file.buffer
        : Buffer.from(req.file.buffer);

      const utf8Text = iconv.decode(buf, 'utf8');

      // проста хевристика: ако има replacement chars � или типични UTF-8/CP1251 несъответствия → CP1251
      const looksBroken =
        /�/.test(utf8Text) ||
        /╨|╤|╟|╫|╣|╥/.test(utf8Text);

      const csvText = looksBroken ? iconv.decode(buf, 'win1251') : utf8Text;

      // 3) Парсваме CSV текста през поток
      const { Readable } = require('stream');
      const textStream = Readable.from([csvText]);

      const results = await new Promise((resolve, reject) => {
        const rows = [];
        textStream
          .pipe(csv()) // ако е ; вместо ,: csv({ separator: ';' })
          .on('data', (row) => rows.push(row))
          .on('end', () => resolve(rows))
          .on('error', reject);
      });

      // 4) Викаме DB слоя – той връща { createdCount, updatedCount, enrichedCount, enrichedVerbs, ... }
      const result = await VerbsDBApi.bulkImport(results, {
        transaction,
        currentUser: req.currentUser,
        ignoreDuplicates: true,
        validate: true,
      });

      await transaction.commit();
      return result;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }


  static async update(data, id, currentUser) {
    const transaction = await db.sequelize.transaction();
    try {
      let verbs = await VerbsDBApi.findBy({ id }, { transaction });

      if (!verbs) {
        throw new ValidationError('verbsNotFound');
      }

      const updatedVerbs = await VerbsDBApi.update(id, data, {
        currentUser,
        transaction,
      });

      await transaction.commit();
      return updatedVerbs;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  static async deleteByIds(ids, currentUser) {
    const transaction = await db.sequelize.transaction();

    try {
      await VerbsDBApi.deleteByIds(ids, {
        currentUser,
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  static async remove(id, currentUser) {
    const transaction = await db.sequelize.transaction();

    try {
      await VerbsDBApi.remove(id, {
        currentUser,
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
};
