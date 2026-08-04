// server.js

const express = require('express');
const db = require('./db');

// Nettoie un texte pour comparer les réponses (enlève espaces, majuscules, accents)
function normaliser(texte) {
  return texte
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // enlève les accents
}
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = 3000;

// Permet au serveur de comprendre le JSON envoyé depuis le navigateur
app.use(express.json());

// Permet de servir des fichiers statiques (HTML, CSS, JS) depuis le dossier "public"
app.use(express.static('public'));

// Fonction pour générer un slug unique à partir du nom du challenge
function genererSlug(nom) {
  const base = nom
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève les accents
    .replace(/[^a-z0-9]+/g, '-') // remplace les espaces/caractères spéciaux par des tirets
    .replace(/(^-|-$)/g, ''); // enlève les tirets au début/fin

  const suffixe = Math.random().toString(36).substring(2, 6); // 4 caractères aléatoires
  return `${base}-${suffixe}`;
}

// Route pour CRÉER un challenge (appelée par le formulaire organisateur)
app.post('/api/challenges', (req, res) => {
  const {
    nom, description, date_heure,
    inscription_debut, inscription_fin,
    confirmation_debut, confirmation_fin,
    nombre_questions, duree_reponse,
    nombre_gagnants, bareme_points, recompenses,
    joker_actif, bonus_actif, indices_actif
  } = req.body;

  // Vérification simple : le nom est obligatoire
  if (!nom) {
    return res.status(400).json({ erreur: 'Le nom du challenge est obligatoire' });
  }
// Vérifie qu'aucune date n'est dans le passé
  const maintenant = new Date();
  const datesAVerifier = { date_heure, inscription_debut, inscription_fin, confirmation_debut, confirmation_fin };

  for (const [champ, valeur] of Object.entries(datesAVerifier)) {
    if (new Date(valeur) < maintenant) {
      return res.status(400).json({ erreur: `La date "${champ}" ne peut pas être dans le passé` });
    }
  }

  // Vérifie une logique de cohérence : la fin doit être après le début
  if (new Date(inscription_fin) <= new Date(inscription_debut)) {
    return res.status(400).json({ erreur: 'La fin des inscriptions doit être après leur début' });
  }
  if (new Date(confirmation_fin) <= new Date(confirmation_debut)) {
    return res.status(400).json({ erreur: 'La fin des confirmations doit être après leur début' });
  }
  // Vérifie l'ordre chronologique global : inscriptions → confirmations → challenge
  if (new Date(inscription_fin) > new Date(confirmation_debut)) {
    return res.status(400).json({ erreur: 'La fin des inscriptions doit précéder le début des confirmations' });
  }
  if (new Date(confirmation_fin) > new Date(date_heure)) {
    return res.status(400).json({ erreur: 'La fin des confirmations doit précéder la date/heure du challenge' });
  }
  const slug = genererSlug(nom);

  const stmt = db.prepare(`
    INSERT INTO challenges (
      slug, nom, description, date_heure,
      inscription_debut, inscription_fin,
      confirmation_debut, confirmation_fin,
      nombre_questions, duree_reponse,
      nombre_gagnants, bareme_points, recompenses,
      joker_actif, bonus_actif, indices_actif
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    slug, nom, description, date_heure,
    inscription_debut, inscription_fin,
    confirmation_debut, confirmation_fin,
    nombre_questions, duree_reponse,
    nombre_gagnants || 3, bareme_points || '3,2,1', recompenses || '[]',
    joker_actif ? 1 : 0, bonus_actif ? 1 : 0, indices_actif ? 1 : 0
  );

  res.json({
    succes: true,
    id: result.lastInsertRowid,
    slug: slug,
    lien: `/join/${slug}`
  });
});

// Quand quelqu'un visite /join/n'importe-quel-slug, on lui sert la page join.html
app.get('/join/:slug', (req, res) => {
  res.sendFile(__dirname + '/public/join.html');
});
// Route pour récupérer un challenge par son slug (utilisée par la page d'inscription)
app.get('/api/challenges/:slug', (req, res) => {
  const { slug } = req.params;

  const challenge = db.prepare('SELECT * FROM challenges WHERE slug = ?').get(slug);

  if (!challenge) {
    return res.status(404).json({ erreur: 'Challenge introuvable' });
  }

  res.json(challenge);
});

// Route pour inscrire un participant à un challenge
app.post('/api/challenges/:slug/participants', (req, res) => {
  const { slug } = req.params;
  const { nom, telephone } = req.body;

  if (!nom || !telephone) {
    return res.status(400).json({ erreur: 'Le nom et le téléphone sont obligatoires' });
  }

  const challenge = db.prepare('SELECT * FROM challenges WHERE slug = ?').get(slug);
  if (!challenge) {
    return res.status(404).json({ erreur: 'Challenge introuvable' });
  }

  // Vérifie que la période d'inscription est bien ouverte
  const maintenant = new Date();
  const debut = new Date(challenge.inscription_debut);
  const fin = new Date(challenge.inscription_fin);

  if (maintenant < debut || maintenant > fin) {
    return res.status(400).json({ erreur: 'Les inscriptions ne sont pas ouvertes actuellement' });
  }

  const stmt = db.prepare(`
    INSERT INTO participants (challenge_id, nom, telephone)
    VALUES (?, ?, ?)
  `);

  const result = stmt.run(challenge.id, nom, telephone);

  res.json({
    succes: true,
    participant_id: result.lastInsertRowid
  });
});
// Route pour retrouver un participant grâce à son numéro de téléphone
app.get('/api/challenges/:slug/participants/lookup', (req, res) => {
  const { slug } = req.params;
  const { telephone } = req.query; // ex: /lookup?telephone=0700000000

  if (!telephone) {
    return res.status(400).json({ erreur: 'Numéro de téléphone requis' });
  }

  const challenge = db.prepare('SELECT * FROM challenges WHERE slug = ?').get(slug);
  if (!challenge) {
    return res.status(404).json({ erreur: 'Challenge introuvable' });
  }

  const participant = db.prepare(
    'SELECT * FROM participants WHERE challenge_id = ? AND telephone = ?'
  ).get(challenge.id, telephone);

  if (!participant) {
    return res.status(404).json({ trouve: false });
  }

  res.json({ trouve: true, participant });
});

// Route pour confirmer sa présence
app.post('/api/challenges/:slug/participants/:id/confirmer', (req, res) => {
  const { slug, id } = req.params;

  const challenge = db.prepare('SELECT * FROM challenges WHERE slug = ?').get(slug);
  if (!challenge) {
    return res.status(404).json({ erreur: 'Challenge introuvable' });
  }

  // On vérifie que la période de confirmation est bien ouverte
  const maintenant = new Date();
  const debut = new Date(challenge.confirmation_debut);
  const fin = new Date(challenge.confirmation_fin);

  if (maintenant < debut || maintenant > fin) {
    return res.status(400).json({ erreur: 'La période de confirmation n\'est pas ouverte actuellement' });
  }

  const participant = db.prepare('SELECT * FROM participants WHERE id = ? AND challenge_id = ?').get(id, challenge.id);
  if (!participant) {
    return res.status(404).json({ erreur: 'Participant introuvable' });
  }

  db.prepare('UPDATE participants SET confirme = 1 WHERE id = ?').run(id);

  res.json({ succes: true });
});
// Route pour récupérer les statistiques d'un challenge (utile pour la salle d'attente)
app.get('/api/challenges/:slug/stats', (req, res) => {
  const { slug } = req.params;

  const challenge = db.prepare('SELECT * FROM challenges WHERE slug = ?').get(slug);
  if (!challenge) {
    return res.status(404).json({ erreur: 'Challenge introuvable' });
  }

  const { nombre_confirmes } = db.prepare(
    'SELECT COUNT(*) as nombre_confirmes FROM participants WHERE challenge_id = ? AND confirme = 1'
  ).get(challenge.id);

  res.json({
    date_heure: challenge.date_heure,
    nombre_confirmes,
    nombre_questions: challenge.nombre_questions,
    duree_reponse: challenge.duree_reponse,
    joker_actif: challenge.joker_actif,
    bonus_actif: challenge.bonus_actif,
    indices_actif: challenge.indices_actif
  });
});
// Route pour ajouter une question à un challenge
app.post('/api/challenges/:slug/questions', (req, res) => {
  const { slug } = req.params;
  const { ordre, texte, type, bonnes_reponses, indice_1, indice_2, indice_3, est_bonus } = req.body;

  const challenge = db.prepare('SELECT * FROM challenges WHERE slug = ?').get(slug);
  if (!challenge) {
    return res.status(404).json({ erreur: 'Challenge introuvable' });
  }

  if (!texte || !bonnes_reponses) {
    return res.status(400).json({ erreur: 'Le texte et la bonne réponse sont obligatoires' });
  }

  const stmt = db.prepare(`
    INSERT INTO questions (challenge_id, ordre, texte, type, bonnes_reponses, indice_1, indice_2, indice_3, est_bonus)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    challenge.id, ordre, texte, type || 'normale', bonnes_reponses,
    indice_1 || null, indice_2 || null, indice_3 || null, est_bonus ? 1 : 0
  );

  res.json({ succes: true, id: result.lastInsertRowid });
});

// Route pour récupérer toutes les questions d'un challenge
app.get('/api/challenges/:slug/questions', (req, res) => {
  const { slug } = req.params;

  const challenge = db.prepare('SELECT * FROM challenges WHERE slug = ?').get(slug);
  if (!challenge) {
    return res.status(404).json({ erreur: 'Challenge introuvable' });
  }

  const questions = db.prepare('SELECT * FROM questions WHERE challenge_id = ? ORDER BY ordre').all(challenge.id);

  res.json(questions);
});
// Route pour LANCER une question (déclenchée par l'organisateur)
app.post('/api/challenges/:slug/questions/:id/lancer', (req, res) => {
  const { slug, id } = req.params;

  const challenge = db.prepare('SELECT * FROM challenges WHERE slug = ?').get(slug);
  if (!challenge) {
    return res.status(404).json({ erreur: 'Challenge introuvable' });
  }

  const question = db.prepare('SELECT * FROM questions WHERE id = ? AND challenge_id = ?').get(id, challenge.id);
  if (!question) {
    return res.status(404).json({ erreur: 'Question introuvable' });
  }
  // On empêche de lancer une question avant l'heure officielle du challenge
  if (new Date() < new Date(challenge.date_heure)) {
    return res.status(400).json({ erreur: `Le challenge ne commence qu'à ${new Date(challenge.date_heure).toLocaleString('fr-FR')}. Impossible de lancer une question avant.` });
  }

  const maintenant = new Date().toISOString();
  console.log(`🚀 Lancement de la question ${question.id} (type: ${question.type})`);

  db.prepare('UPDATE questions SET statut = ?, lancee_a = ? WHERE id = ?').run('en_cours', maintenant, question.id);

  io.to(`challenge_${challenge.id}`).emit('nouvelle_question', {
    id: question.id,
    ordre: question.ordre,
    texte: question.texte,
    type: question.type,
    duree_reponse: challenge.duree_reponse,
    lancee_a: maintenant
  });

  if (question.type === 'indices') {
    // Question à indices : 3 paliers espacés de "duree_reponse" secondes
    const intervalle = challenge.duree_reponse * 1000;

    setTimeout(() => {
      const indice2A = new Date().toISOString();
      db.prepare('UPDATE questions SET indice2_a = ? WHERE id = ?').run(indice2A, question.id);
      io.to(`challenge_${challenge.id}`).emit('nouvel_indice', {
        question_id: question.id, numero: 2, texte: question.indice_2
      });
    }, intervalle);

    setTimeout(() => {
      const indice3A = new Date().toISOString();
      db.prepare('UPDATE questions SET indice3_a = ? WHERE id = ?').run(indice3A, question.id);
      io.to(`challenge_${challenge.id}`).emit('nouvel_indice', {
        question_id: question.id, numero: 3, texte: question.indice_3
      });
    }, intervalle * 2);

    setTimeout(() => {
      corrigerQuestionIndices(question.id);
    }, intervalle * 3 + 1500);

  } else {
    // Question normale : correction après le temps de réponse habituel
    setTimeout(() => {
      corrigerQuestion(question.id);
    }, (challenge.duree_reponse * 1000) + 1500);
  }

  res.json({ succes: true });
});
// Corrige une question : détermine les 3 premiers, calcule les points, diffuse les résultats
function corrigerQuestion(questionId) {
  const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId);
  if (!question || question.statut === 'terminee') return; // évite de corriger 2 fois

  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(question.challenge_id);
  const bonnesReponses = question.bonnes_reponses.split(',').map(r => normaliser(r));

  const reponses = db.prepare('SELECT * FROM answers WHERE question_id = ? ORDER BY recue_a ASC').all(questionId);

  // On détermine quelles réponses sont correctes, dans l'ordre d'arrivée
  const correctes = reponses.filter(r => bonnesReponses.includes(normaliser(r.reponse_texte)));

  const majReponse = db.prepare('UPDATE answers SET est_correcte = ?, points_attribues = ? WHERE id = ?');

  // On marque d'abord TOUTES les réponses comme non-gagnantes par défaut
  reponses.forEach(r => {
    const estCorrecte = correctes.includes(r);
    majReponse.run(estCorrecte ? 1 : 0, 0, r.id);
  });

  // On attribue les points selon le barème choisi par l'organisateur pour CE challenge
  const bareme = challenge.bareme_points.split(',').map(Number);
  const top3 = correctes.slice(0, challenge.nombre_gagnants);
  const resultats = [];

  top3.forEach((reponse, index) => {
    let points = bareme[index];

    // Le Joker double les points du 1er (3 → 6), mais ne s'applique qu'au 1er
    if (index === 0 && reponse.joker_active) {
      points = 6;
    }

    // Une question BONUS double tous les points
    if (question.est_bonus) {
      points = points * 2;
    }

    majReponse.run(1, points, reponse.id);

    const participant = db.prepare('SELECT * FROM participants WHERE id = ?').get(reponse.participant_id);
    db.prepare('UPDATE participants SET score_total = score_total + ? WHERE id = ?').run(points, reponse.participant_id);

    resultats.push({ participant_id: reponse.participant_id, nom: participant.nom, points, position: index + 1 });
  });

  // Le Joker est "consommé" pour tout participant qui l'a activé sur cette question (gagnant ou pas)
  reponses.filter(r => r.joker_active).forEach(r => {
    db.prepare('UPDATE participants SET joker_utilise = 1 WHERE id = ?').run(r.participant_id);
  });

  db.prepare('UPDATE questions SET statut = ? WHERE id = ?').run('terminee', questionId);

  // On diffuse les résultats à tout le monde
  io.to(`challenge_${challenge.id}`).emit('resultats_question', {
    question_id: questionId,
    bonne_reponse: question.bonnes_reponses.split(',')[0],
    est_bonus: !!question.est_bonus,
    top3: resultats
  });

  console.log(`✅ Question ${questionId} corrigée. Top 3 :`, resultats);
  diffuserClassement(challenge.id); // ← nouvelle ligne
}
// Corrige une question à INDICES : les points dépendent du moment de la réponse
function corrigerQuestionIndices(questionId) {
  const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId);
  if (!question || question.statut === 'terminee') return;

  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(question.challenge_id);
  const bonnesReponses = question.bonnes_reponses.split(',').map(r => normaliser(r));
  const reponses = db.prepare('SELECT * FROM answers WHERE question_id = ? ORDER BY recue_a ASC').all(questionId);

  const majReponse = db.prepare('UPDATE answers SET est_correcte = ?, points_attribues = ? WHERE id = ?');
  const paliers = { 1: 5, 2: 2, 3: 1 }; // barème fixe pour les indices
  const resultatsParPalier = { 1: [], 2: [], 3: [] };

  reponses.forEach(r => {
    const estCorrecte = bonnesReponses.includes(normaliser(r.reponse_texte));

    if (!estCorrecte) {
      majReponse.run(0, 0, r.id);
      return;
    }

    // On détermine dans quel palier tombe cette réponse
    let palier;
    if (r.recue_a <= question.indice2_a) {
      palier = 1;
    } else if (r.recue_a <= question.indice3_a) {
      palier = 2;
    } else {
      palier = 3;
    }

    let points = paliers[palier];
    if (question.est_bonus) points = points * 2;

    majReponse.run(1, points, r.id);

    const participant = db.prepare('SELECT * FROM participants WHERE id = ?').get(r.participant_id);
    db.prepare('UPDATE participants SET score_total = score_total + ? WHERE id = ?').run(points, r.participant_id);

    resultatsParPalier[palier].push({ nom: participant.nom, points });
  });

  db.prepare('UPDATE questions SET statut = ? WHERE id = ?').run('terminee', questionId);

  io.to(`challenge_${challenge.id}`).emit('resultats_question_indices', {
    question_id: questionId,
    bonne_reponse: question.bonnes_reponses.split(',')[0],
    est_bonus: !!question.est_bonus,
    paliers: resultatsParPalier
  });

  console.log(`✅ Question à indices ${questionId} corrigée.`, resultatsParPalier);
  diffuserClassement(challenge.id); // ← nouvelle ligne
}
// Calcule et diffuse le classement général actuel d'un challenge
function diffuserClassement(challengeId) {
  const classement = db.prepare(`
    SELECT id, nom, score_total
    FROM participants
    WHERE challenge_id = ? AND confirme = 1
    ORDER BY score_total DESC, id ASC
  `).all(challengeId);

  // On ajoute la position de chacun (1er, 2e, 3e...)
  const classementAvecPosition = classement.map((p, index) => ({
    position: index + 1,
    nom: p.nom,
    score: p.score_total
  }));

  io.to(`challenge_${challengeId}`).emit('classement_mis_a_jour', classementAvecPosition);

  console.log(`🏆 Classement diffusé pour le challenge ${challengeId}`);
}
// Route pour récupérer l'historique complet d'un participant à travers TOUS les challenges
app.get('/api/participants/historique', (req, res) => {
  const { telephone } = req.query;

  if (!telephone) {
    return res.status(400).json({ erreur: 'Numéro de téléphone requis' });
  }

  // On récupère toutes les fiches "participant" liées à ce numéro (une par challenge)
  const participations = db.prepare(`
    SELECT p.*, c.nom as challenge_nom, c.slug as challenge_slug, c.statut as challenge_statut, c.date_heure
    FROM participants p
    JOIN challenges c ON p.challenge_id = c.id
    WHERE p.telephone = ?
    ORDER BY c.date_heure DESC
  `).all(telephone);

  if (participations.length === 0) {
    return res.json({ trouve: false });
  }

  const nom = participations[0].nom;

  // Pour chaque participation, on calcule sa position finale dans le challenge concerné
  const historique = participations.map(p => {
    const classementChallenge = db.prepare(`
      SELECT id FROM participants
      WHERE challenge_id = ? AND confirme = 1
      ORDER BY score_total DESC, id ASC
    `).all(p.challenge_id);

    const position = classementChallenge.findIndex(c => c.id === p.id) + 1; // +1 car findIndex commence à 0
    const positionAffichee = p.confirme ? position : null;

    // Nombre de bonnes réponses données par ce participant dans ce challenge
    const { bonnesReponses } = db.prepare(`
      SELECT COUNT(*) as bonnesReponses FROM answers
      WHERE participant_id = ? AND est_correcte = 1
    `).get(p.id);

    return {
      challenge_nom: p.challenge_nom,
      challenge_slug: p.challenge_slug,
      challenge_statut: p.challenge_statut,
      date: p.date_heure,
      score: p.score_total,
      position: positionAffichee,
      bonnesReponses
    };
  });

  // Statistiques globales, calculées sur l'ensemble des participations
  const stats = {
    nom,
    nombreChallenges: historique.length,
    victoires: historique.filter(h => h.position === 1).length,
    podiums: historique.filter(h => h.position >= 1 && h.position <= 3).length,
    totalBonnesReponses: historique.reduce((total, h) => total + h.bonnesReponses, 0),
    meilleurePosition: historique.reduce((min, h) => (h.position && h.position < min) ? h.position : min, Infinity)
  };

  if (stats.meilleurePosition === Infinity) stats.meilleurePosition = null;

  res.json({ trouve: true, stats, historique });
});
// Gestion des connexions Socket.io
io.on('connection', (socket) => {
  console.log('🔌 Un client vient de se connecter :', socket.id);

  // On garde en mémoire à quel participant correspond ce socket
  let participantIdActuel = null;

  socket.on('rejoindre_challenge', (challengeId) => {
    socket.join(`challenge_${challengeId}`);
    console.log(`👥 ${socket.id} a rejoint la room du challenge ${challengeId}`);
  });

  // Le participant s'identifie (on en aura besoin pour savoir QUI répond)
  socket.on('identifier_participant', (participantId) => {
    participantIdActuel = participantId;
    console.log(`🆔 ${socket.id} correspond au participant ${participantId}`);
  });

  // Réception d'une réponse à une question
  socket.on('envoyer_reponse', (data) => {
    const recueA = new Date().toISOString(); // ⏱️ l'instant exact de réception, la ligne la plus importante du projet !

    if (!participantIdActuel) {
      console.log('⚠️ Réponse reçue mais participant non identifié, ignorée.');
      return;
    }

    // Sécurité : empêche un participant de répondre 2 fois à la même question
    const dejaRepondu = db.prepare(
      'SELECT * FROM answers WHERE question_id = ? AND participant_id = ?'
    ).get(data.question_id, participantIdActuel);

    if (dejaRepondu) {
      console.log(`⚠️ Le participant ${participantIdActuel} a déjà répondu à cette question, ignoré.`);
      return;
    }

    const stmt = db.prepare(`
      INSERT INTO answers (question_id, participant_id, reponse_texte, joker_active, recue_a)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(data.question_id, participantIdActuel, data.reponse, data.joker ? 1 : 0, recueA);

    console.log(`📝 Réponse enregistrée : participant ${participantIdActuel}, question ${data.question_id}, à ${recueA}`);

    // On confirme au participant que sa réponse est bien enregistrée
    socket.emit('reponse_confirmee', { question_id: data.question_id });
  });

  socket.on('disconnect', () => {
    console.log('❌ Un client s\'est déconnecté :', socket.id);
  });
});

http.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur http://127.0.0.1:${PORT}`);
});
// Route pour terminer un challenge manuellement (déclenchée par l'organisateur)
app.post('/api/challenges/:slug/terminer', (req, res) => {
  const { slug } = req.params;

  const challenge = db.prepare('SELECT * FROM challenges WHERE slug = ?').get(slug);
  if (!challenge) {
    return res.status(404).json({ erreur: 'Challenge introuvable' });
  }

  db.prepare('UPDATE challenges SET statut = ? WHERE id = ?').run('termine', challenge.id);

  // Classement final complet
  const classementFinal = db.prepare(`
    SELECT id, nom, score_total
    FROM participants
    WHERE challenge_id = ? AND confirme = 1
    ORDER BY score_total DESC, id ASC
  `).all(challenge.id);

  const listeRecompenses = JSON.parse(challenge.recompenses || '[]');
  const medaillesParDefaut = ['🥇', '🥈', '🥉'];

  const classementAvecRecompenses = classementFinal.map((p, index) => {
    const texteRecompense = listeRecompenses[index]; // undefined si pas de récompense à cette position
    const medaille = medaillesParDefaut[index] || `#${index + 1}`;

    return {
      position: index + 1,
      nom: p.nom,
      score: p.score_total,
      recompense: texteRecompense ? `${medaille} ${texteRecompense}` : null
    };
  });

  io.to(`challenge_${challenge.id}`).emit('challenge_termine', {
    classement: classementAvecRecompenses
  });

  console.log(`🏁 Challenge ${challenge.id} terminé. Classement final :`, classementAvecRecompenses);

  res.json({ succes: true, classement: classementAvecRecompenses });
});