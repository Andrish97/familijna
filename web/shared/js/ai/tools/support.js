// Narzędzia czatu AI: zgłoszenie problemu (decyzja 16) — czat tylko wypełnia
// formularz Kontaktu (temat, opis); sprawdza i wysyła użytkownik, sam
// przechodząc zabezpieczenie przed botami. Bez wysyłania w tle i bez danych
// spoza rozmowy — do opisu dochodzi tylko adres strony, na której jest użytkownik.

export default [
  {
    name: "report_problem",
    description: "Open the contact form filled with a problem report for the Familijna team. Use only when the user asks to report a problem or a bug (or agrees after you suggest it), after you could not solve it with the manual. Write a short subject and a clear description: what the user did, what happened, what they expected. The user reviews and sends the form themselves.",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Max 120 characters." },
        description: { type: "string", description: "Max 3000 characters, in the user's language." },
      },
      required: ["subject", "description"],
    },
    readOnly: true,
    where: "browser",
    async run({ subject, description }, ctx) {
      const where = ctx.pagePath || "";
      await ctx.openContactForm({
        subject: String(subject || "").slice(0, 120),
        message: `${String(description || "").slice(0, 3000)}${where ? `\n\n— ${where}` : ""}`,
      });
      return { ok: true, opened: "contact_form", note: "The user reviews and sends it; nothing was sent yet." };
    },
  },
];
