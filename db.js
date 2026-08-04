// db.js
// Ce fichier gère notre base de données SQLite

const Database = require('better-sqlite3');
const db = new Database('challengehub.db'); // crée un fichier challengehub.db sur ton PC

// On active les clés étrangères (pour lier les tables entre elles proprement)
db.pragma('foreign_keys = ON');

// Table des challenges
db.exec(`
  CREATE TABLE IF NOT EXISTS challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    nom TEXT NOT NULL,
    description TEXT,
    date_heure TEXT,
    inscription_debut TEXT,
    inscription_fin TEXT,
    confirmation_debut TEXT,
    confirmation_fin TEXT,
    nombre_questions INTEGER,
    duree_reponse INTEGER,
    nombre_gagnants INTEGER DEFAULT 3,
    bareme_points TEXT DEFAULT '3,2,1',
    recompenses TEXT DEFAULT '[]',
    joker_actif INTEGER DEFAULT 1,
    bonus_actif INTEGER DEFAULT 1,
    indices_actif INTEGER DEFAULT 1,
    statut TEXT DEFAULT 'en_preparation',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Table des participants
db.exec(`
  CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id INTEGER NOT NULL,
    nom TEXT NOT NULL,
    telephone TEXT NOT NULL,
    confirme INTEGER DEFAULT 0,
    joker_utilise INTEGER DEFAULT 0,
    score_total INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (challenge_id) REFERENCES challenges(id)
  )
`);

// Table des questions
db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id INTEGER NOT NULL,
    ordre INTEGER NOT NULL,
    texte TEXT NOT NULL,
    type TEXT DEFAULT 'normale',
    bonnes_reponses TEXT NOT NULL,
    indice_1 TEXT,
    indice_2 TEXT,
    indice_3 TEXT,
    est_bonus INTEGER DEFAULT 0,
    statut TEXT DEFAULT 'en_attente',
    lancee_a TEXT,
    indice2_a TEXT,
    indice3_a TEXT,
    FOREIGN KEY (challenge_id) REFERENCES challenges(id)
  )
`);

// Table des réponses
db.exec(`
  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    participant_id INTEGER NOT NULL,
    reponse_texte TEXT NOT NULL,
    joker_active INTEGER DEFAULT 0,
    est_correcte INTEGER,
    points_attribues INTEGER DEFAULT 0,
    recue_a TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (question_id) REFERENCES questions(id),
    FOREIGN KEY (participant_id) REFERENCES participants(id)
  )
`);

console.log('✅ Base de données initialisée avec succès');

module.exports = db;