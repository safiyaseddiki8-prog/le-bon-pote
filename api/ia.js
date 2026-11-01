// Fonction « serveur » de Vercel : c'est ELLE qui parle à Gemini.
// La clé GEMINI_API_KEY reste dans les variables Vercel : elle n'est jamais envoyée au navigateur.
const { PROMPTS } = require('./_prompts.js');

// Infos publiques de Supabase (les mêmes que dans index.html) : servent à vérifier que l'utilisateur est connecté.
const SUPABASE_URL = 'https://vvmjwavdgynoxcwonulh.supabase.co';
const SUPABASE_CLE_PUBLIQUE = 'sb_publishable_9C6yu87w8il49xSCxpisRA_13jgF0wf';

// Modèles essayés dans l'ordre (si l'un est saturé, on passe au suivant)
const MODELES = [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'].filter(Boolean);

const LONGUEUR_MAX = { profil: 15000, annonce: 300 };

async function utilisateurConnecte(req) {
  const jeton = (req.headers.authorization || '').replace('Bearer ', '');
  if (!jeton) return null;
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: SUPABASE_CLE_PUBLIQUE, Authorization: 'Bearer ' + jeton }
  });
  return r.ok ? r.json() : null;
}

async function appelerGemini(prompt, texte) {
  let derniereErreur = 'aucun modèle disponible';
  for (const modele of MODELES) {
    try {
      const r = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + modele + ':generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: prompt.systeme }] },
            contents: [{ role: 'user', parts: [{ text: prompt.prefixe + texte + prompt.suffixe }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.4 }
          })
        }
      );
      if (!r.ok) { derniereErreur = modele + ' : ' + r.status; continue; }
      const data = await r.json();
      const brut = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      return JSON.parse(brut);
    } catch (e) {
      derniereErreur = modele + ' : ' + e.message;
    }
  }
  throw new Error(derniereErreur);
}

// On ne garde que ce qui est attendu, au bon format (on ne fait pas confiance aveuglément à l'IA)
function nettoyer(tache, resultat) {
  if (tache === 'profil') {
    const liste = Array.isArray(resultat?.competences) ? resultat.competences : [];
    return {
      competences: liste
        .filter((c) => typeof c === 'string')
        .map((c) => c.trim().slice(0, 40))
        .filter((c) => c.length > 0)
        .slice(0, 10)
    };
  }
  return {
    titre: String(resultat?.titre || '').trim().slice(0, 100),
    description: String(resultat?.description || '').trim().slice(0, 1000)
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ erreur: 'Méthode non autorisée' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ erreur: "La clé de l'IA n'est pas configurée." });

  // 1. Seuls les étudiants connectés peuvent utiliser l'IA (pour protéger le quota gratuit)
  const user = await utilisateurConnecte(req);
  if (!user) return res.status(401).json({ erreur: 'Connecte-toi pour utiliser l\'IA.' });

  // 2. On vérifie la demande
  const corps = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const tache = corps.tache;
  const texte = String(corps.texte || '').trim();
  if (!PROMPTS[tache]) return res.status(400).json({ erreur: 'Tâche inconnue.' });
  if (texte.length < 2) return res.status(400).json({ erreur: 'Le texte est vide.' });

  // 3. On appelle l'IA, puis on nettoie sa réponse
  try {
    const resultat = await appelerGemini(PROMPTS[tache], texte.slice(0, LONGUEUR_MAX[tache]));
    return res.status(200).json(nettoyer(tache, resultat));
  } catch (e) {
    console.error('Erreur IA :', e.message);
    return res.status(503).json({ erreur: "L'IA ne répond pas pour le moment. Tu peux remplir à la main." });
  }
};
