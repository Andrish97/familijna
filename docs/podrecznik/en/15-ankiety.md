# 15. Polls and collecting answers

## 15.1 Preparing and starting a poll

A poll belongs to a game of the **Standard poll** or **Points** type (→ 7.1). Its results
are turned into a board of answers with points (→ 2.4).

Before you start a poll, the game must have **at least 10 questions**, and in a "Points" game — from 3 to
6 answers in every question (→ 7.6). Until the game meets these conditions, the [Poll] button
in *My games* is inactive, and the poll page (e.g. opened from a saved address) is blocked
entirely with the message "Not available in this game state" and the reason, for example "The
game needs at least 10 questions (you have 4).".

1. In *My games*, select the game and choose [Poll].
2. Choose [Start] and confirm in the "Start poll?" window. The link, the QR code and invitations
   for recipients are available only after the start (→ 15.2).

![Poll draft](zrzut:polls-draft-points)
![Draft — too few questions](zrzut:polls-draft-text-blocked)
![Launching the poll](zrzut:polls-open-confirm)

From this moment the poll is **open**: voters can answer, and the game cannot be edited
(→ 7.5).

| Poll state | What happens |
|---|---|
| Draft | The poll has not been started. |
| Open | Answers are being collected. |
| Stopped | Collecting is paused; you can resume it or count the votes. |
| Ready | The poll is closed and the game is ready to play. |

## 15.2 Choosing how people vote

The "Sharing" card offers two ways:

**Anonymous** — for anyone who gets the link:

- [Copy link] copies the voting link, and [Open] opens the poll in a new tab,
- a QR code to scan with a phone — click it to show it full screen.

Voters are anonymous — you only see the number of votes. On one device the next person can vote after 30 seconds (e.g. when several people share a phone). Link votes cannot be tied to people — someone can vote several times, e.g. from another browser. When the result matters, invite recipients (below): each of them votes once.

![Sharing — link and QR code](zrzut:poll-share)
![Sharing — link and QR code — phone](zrzut:poll-share-phone@phone)
![Enlarged QR code](zrzut:polls-qr-vote-modal)

**QR code on a TV or projector.** [QR on display] shows the 6-digit code of the "QR Display"
screen — it is a code for connecting the screen, not for voting. On the TV, open
familijna.app → [Connect device] and enter the code (no login needed). The screen shows
a large voting QR code that participants scan with their phones. [Open] opens this screen on
the current device (for example, to send it over HDMI), and [Copy] copies the code. The screen has
a full-screen button, and once the poll is closed it shows "The poll has been closed". The button works
only after the poll has been started.

![QR on the display — the screen connection code](zrzut:polls-qr-display-modal)
![The QR display with the voting code](zrzut:polls-vote-qr)

**Recipients** — personal invitations for friends (→ 10) and subscribers (→ 14):

1. Choose [Add recipients] and select people.
2. Choose [Send invitations]. Each person gets a task in the app (→ 15.4) or an email
   with a link.

Each recipient has a status: waiting, opened, voted or declined, and above the list there is
a summary "Invited · Voted · Declined". You can send [Remind] to people who have not answered yet
— at most twice. [Remove sharing] withdraws the invitation.

![Add recipients](zrzut:poll-recipients-tools)
![Recipient statuses](zrzut:polls-open-recipients-tab@phone)

You can combine both ways — the votes are counted together.

A subscriber without an account can view their invitations and opt out of them on the
*My notifications* page.

## 15.3 Voting

A voter opens the poll from the link, the QR code, an email or a task.

- Questions are shown one at a time ("Question 3/10").
- In a standard poll, voters type their own answer — up to 17 characters. Emoji and characters
  the Display cannot show are left out.
- In a "Points" poll, voters choose one of the given answers.
- You can't skip a question or go back to the previous one. In a "Points" poll, clicking
  an answer moves on right away; in a standard poll you have to type something.
- Answers are sent together **after the last question**. Anyone who leaves earlier is not
  counted.
- At the end, "Thanks for participating!" appears.

![Voting in a “Points” poll](zrzut:polls-vote-points-progress@phone)
![Text voting — character counter](zrzut:polls-vote-text-typing@phone)
![Thank you for taking part!](zrzut:polls-vote-text-thanks@phone)
![The poll is stopped](zrzut:polls-vote-text-stopped@phone)

A person invited by name votes in the same way; their status for the poll owner changes to
"voted". A person without an account can open the poll from the email or from the
*My notifications* page.

## 15.4 Tasks and voting invitations

A task is a poll invitation you got from a friend. You will find tasks on the
*Tasks* page:

- "To do" — polls waiting for your vote: [Vote] opens the poll, [Decline]
  means you will not take part (the poll disappears from the list),
- "Done" — polls you have already voted in (collapsed, shown for 5 days).

![Tasks](zrzut:tasks)
![Done](zrzut:tasks-done-open)

People without an account have their tasks on the *My notifications* page.

## 15.5 Running the vote

The "Votes" card shows progress: the number of votes cast and — for invitations — the recipients' statuses.

- [Stop] — pauses collecting answers. The link still works, but voters will see
  "The poll is stopped".
- [Resume voting] — opens collecting again.
- [Count votes] — available when the poll is stopped (→ 15.6).
- [Abort] — ends the poll and returns it to a draft. **All votes will be lost.**

![The “Votes” card](zrzut:polls-text)
![Stopping the poll](zrzut:polls-stop-confirm)
![A stopped poll — tally the votes](zrzut:polls-stopped)
![Aborting the poll](zrzut:polls-abort-confirm)

## 15.6 Counting and tidying up the answers

Counting and closing the poll are separate steps. First stop the poll and choose
[Count votes]. You can do this once you have **10 complete polls** (people who answered
all the questions), even if the result does not yet meet the conditions for closing.

**How the app calculates points:**

1. An answer's points are the percentage of complete polls it appeared in, rounded down.
2. Answers below **4 points** are left out.
3. At most the **6** most popular answers go onto the board.
4. To close the poll, every question needs **at least 3** answers with at least
   4 points.

**Standard poll** — tidy up the answers before you approve them:

- the app merges identical entries on its own (regardless of upper or lower case and extra spaces); [Merge duplicates] does it
  again after your corrections,
- drag an answer onto another one to **merge** them (for example "banana" and "bananas") — on
  a phone, use the "Merge with…" button,
- click an answer's text to fix a typo (up to 17 characters),
- [Remove] removes an answer from the results,
- [Undo] and [Redo] undo and restore changes.

After each change the app recalculates the points and the order. The counter "Answers: … (3–6 required)"
shows whether a question meets the conditions. When several answers at the top-six boundary have the same number of
votes, the app shows a tie — [Change tie choice] changes which of them go onto the board.
Your corrections are saved as you go, so you can stop and come back later.

![Merging answers](zrzut:polls-tally-text-merge)
![After merging — conditions met](zrzut:polls-tally-text-merged)
![A tie at the sixth place](zrzut:polls-tally-tie)

**"Points" poll** — the answers are fixed; you only see a preview of the points (answers below
4 points are greyed out).

![Tallying a “Points” poll](zrzut:polls-tally-points)

When everything is right, choose [Approve] and confirm in the window ("Approve the answers?"
in a standard poll, "Count the votes?" in "Points"). The poll moves to the READY state
with the note "ready to play".
[Leave counting] goes back to the stopped poll without closing it.

![Approving the tally](zrzut:polls-tally-text-approve)

## 15.7 Results and using them in the game

After approval, the poll is closed and the game has the READY status — you can play it
with the [Play] button (→ 17). You can view the results in [Preview] in *My games* by switching the view
to "Poll".

![A finished poll — final points](zrzut:polls-ready-text)
![Game preview — the "Poll" view with votes](zrzut:games-preview-poll)

- [Restart] opens a new poll for the same game — the existing votes and results
  will be deleted.
- Editing the game (→ 7.5) or changing its type (→ 7.8) also deletes the results — after you confirm.
- To keep the result and collect a new poll at the same time, duplicate the game first (→ 6.6).
