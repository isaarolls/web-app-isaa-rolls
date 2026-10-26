/* =========================================================
   SOUTHSIDE ENT — DATI DEL SITO
   Modifica solo questo file per aggiornare artisti, uscite,
   playlist ed eventi. Tutte le pagine si aggiornano da sole.
   ========================================================= */

const SITO = {
  emailDemo: "amministrazione@southsiderecords.it",
  // Incolla qui il link della playlist ufficiale (Spotify > Condividi > Copia link)
  playlistUrl: "https://open.spotify.com/playlist/5TN6EYTHXtWtYqMBVcEDX1",
  // ID della playlist (la parte dopo /playlist/ nel link). Serve per il player incorporato.
  playlistId: "5TN6EYTHXtWtYqMBVcEDX1",
  instagram: "https://www.instagram.com/",
  spotify: "https://open.spotify.com/",
  youtube: "https://www.youtube.com/",
  tiktok: "https://www.tiktok.com/",
};

/* slug = nome breve senza spazi, usato nel link diretto (artisti.html#slug) */
/* foto: nome del file immagine caricato accanto alle pagine (lascia "" se non c'è) */
const ARTISTI = [
  {slug:"wherestheplug", nome:"wherestheplug", genere:"Producer", quartiere:"Palermo · classe '95",
   foto:"wherestheplug.jpg",
   breve:"Producer palermitano. Beat visionari, influenze diverse, l'anima di una terra di contaminazioni.",
   bio:[
     "wherestheplug è un producer palermitano classe '95 che fa della versatilità il suo tratto distintivo. Aperto a influenze musicali diverse, rispecchia pienamente la sua Sicilia, terra di contaminazioni dove gli opposti convivono in armonia.",
     "Il producer di Southside è piombato come una meteora nella nuova scena rap: prima locale, poi regionale, fino a quella nazionale. Le sue produzioni hanno suoni visionari, con beat che trasportano e sanno toccare le emozioni di chiunque ascolti.",
     "Il 2023 è stato il suo anno: ha collaborato al nuovo EP di Don Pero, «Mezza Parola», ed è partito in tour con il rapper siracusano toccando i club più importanti d'Italia. Ha lavorato anche con altri nomi di rilievo della scena nazionale, con una forte intesa artistica con 8blevrai e produzioni realizzate con Beba.",
     "Nel 2024 ha firmato la sua prima produzione internazionale con il rapper francese Blasko nel brano «Hakimi» ft. 8blevrai. Il suo ultimo lavoro è ancora con l'artista di Predore, «Vis à vis», prodotto insieme a 2nd Roof, uno dei duo di producer più importanti in Italia."
   ],
   collab:["Don Pero","8blevrai","Beba","Blasko","2nd Roof"],
   tappe:[
     {anno:"2023", testo:"EP «Mezza Parola» di Don Pero e tour nei club italiani"},
     {anno:"2024", testo:"Prima produzione internazionale: «Hakimi», Blasko ft. 8blevrai"},
     {anno:"Ultimo", testo:"«Vis à vis» con 8blevrai, co-prodotto con 2nd Roof"}
   ],
   servizi:["Records"], instagram:"#", spotify:"#", youtube:"#"},
];

/* formato: "Singolo" | "EP" | "Album"   data: "AAAA-MM" */
const USCITE = [
  {cat:"SSE-006", titolo:"Titolo uscita", artista:"Nome Artista", formato:"Singolo", data:"2026-10", link:"#"},
  {cat:"SSE-005", titolo:"Titolo uscita", artista:"Nome Artista", formato:"EP", data:"2026-07", link:"#"},
  {cat:"SSE-004", titolo:"Titolo uscita", artista:"Nome Artista", formato:"Singolo", data:"2026-05", link:"#"},
  {cat:"SSE-003", titolo:"Titolo uscita", artista:"Nome Artista", formato:"Album", data:"2026-02", link:"#"},
  {cat:"SSE-002", titolo:"Titolo uscita", artista:"Nome Artista", formato:"Singolo", data:"2025-11", link:"#"},
  {cat:"SSE-001", titolo:"Titolo uscita", artista:"Nome Artista", formato:"Singolo", data:"2025-09", link:"#"},
];

/* Brani mostrati nella pagina Playlist (anteprima testuale) */
const PLAYLIST_BRANI = [
  {titolo:"Titolo brano", artista:"Nome Artista", durata:"2:48"},
  {titolo:"Titolo brano", artista:"Nome Artista", durata:"3:12"},
  {titolo:"Titolo brano", artista:"Nome Artista", durata:"2:55"},
  {titolo:"Titolo brano", artista:"Nome Artista", durata:"3:31"},
  {titolo:"Titolo brano", artista:"Nome Artista", durata:"2:39"},
  {titolo:"Titolo brano", artista:"Nome Artista", durata:"3:04"},
];

/* data: "AAAA-MM-GG"  stato: "biglietti" | "gratis" | "soldout" */
const EVENTI = [
  {data:"2026-11-21", artista:"Nome Artista", luogo:"Nome locale", citta:"Palermo", stato:"biglietti", link:"#"},
  {data:"2026-12-05", artista:"Nome Artista", luogo:"Nome locale", citta:"Catania", stato:"biglietti", link:"#"},
  {data:"2026-12-19", artista:"Southside Night", luogo:"Nome locale", citta:"Palermo", stato:"gratis", link:"#"},
  {data:"2027-01-16", artista:"Nome Artista", luogo:"Nome locale", citta:"Roma", stato:"soldout", link:"#"},
];
