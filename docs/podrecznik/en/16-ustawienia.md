# 16. Game settings

## 16.1 Preparing the settings

Settings apply to one specific game. You open them with the [Game settings] button
in *My games* or with [Change settings] in the summary in the control panel (→ 17.2).

*Game settings* work on a phone, a tablet and a computer. On a phone, choose a section with the
menu button on the bar below the header.

![Game settings](zrzut:game-settings)
![Game settings on a phone](zrzut:game-settings@phone)

Prepare the settings **before the game starts**. While the game is open in the control panel,
you cannot change its settings. If the game is still running (e.g. you closed the panel during a game), the app
shows "Game in progress": saved changes apply only to the next game, and the game lock expires on its own
after an hour of inactivity (the window shows how much time is left). You can choose
[Go back] or [End game and open settings] — the second option ends the game, and you will have to connect
the devices again.

![Game in progress](zrzut:play-settings-ingame)

The settings are divided into sections: "Teams", "Display", "Sound", "Questions — Settings",
"Questions — Finale", "Questions — Rounds" and "Game settings".

## 16.2 Teams

Enter the "Team A name" and "Team B name" (by default "Team A" and "Team B"). The names
appear on the Display, on the host screen and in the control panel. The length of a name
is limited to what fits on the Display; characters the Display cannot show will not
be accepted.

![Teams](zrzut:play-settings-teams)
![Team names — a name that is too long and unsupported characters](zrzut:game-settings-team-limit)

## 16.3 Display

- **Colors** — the Team A color, the Team B color, the third color and the dot color (the glowing points of
  the Display). Click a color to enter a color code or set it with the sliders.
- **Theme** — "Wings" (default), "Radar", "Cabinet", "Ribbon", "Bridge", "Classic" or "Modern".
  Modern has two animated gaps: the segments emerge below the top counter and travel
  down both sides. The new themes integrate team indicators into their structure.
  Choosing a theme also matches the frames and cover on the Host screen.
  The third color paints selected elements of the theme, and its field is named after them, e.g.
  "Background". Choosing a theme sets this color; you can change it afterwards. Modern does not use
  the third color — the "Third color" field is then greyed out. Your team and dot colors are preserved.
  The system reduced motion setting disables these animations.
- **Logo** — "Default" or one of your logos (→ 8).
- **Host logo** — how the logo looks on the host screen:
  - "Pixels" — the same as on the Display, made of dots,
  - "Source" (the default) — in the form the logo was created in: a text logo as curved lettering
    in the board font, an image logo as the original image, a drawn logo as a smooth
    drawing in the dot color.

  The Display always shows the logo made of dots, because it is a dot screen.

![Choosing a display theme](zrzut:settings-theme-wings)
![Appearance](zrzut:appearance)
![Colour window](zrzut:game-settings-color)
![Host logo — “Pixels”](zrzut:game-settings-display-pixel)

"Display preview" and "Host preview" show the effect of your changes as you make them.

**Theme fonts.** The text on the Host screen (handwritten in the Classic theme, serif in Cabinet,
typewriter-style in the others) and the text logo shown as "Source" use fonts under a free licence
(SIL Open Font License), included with the app — also at commercial events.

## 16.4 Sound

The game has 10 sounds: intro, outro, round transition, final theme, buzzer press, correct answer, wrong answer, repeat answer in the final, time's up and answer reveal. For each of them you can:

- choose a variant — "Classic" or "Custom" (then choose an mp3, wav or ogg file),
- listen to it with the ▶ button,
- set the volume from 0 to 100%.

A custom file can be up to 120 seconds long for the outro, up to 60 seconds for the intro, round transition and final theme,
up to 5 seconds for "Reveals and board transitions" and up to 2 seconds for the other sounds — the operator waits for a sound to finish, so keep short effects short. If you choose "Custom", you must add a file — otherwise
the settings cannot be saved.

![Sound](zrzut:sound)
![Custom sounds](zrzut:game-settings-sound-custom)

Custom files are saved in the app together with the game when you choose [Save] — they will work on any
device where you start this game.

**"Classic" music.** The intro, outro, round transition and final theme are tracks generated
for this app with Suno (suno.com) on a paid plan that allows commercial use. They are not
excerpts from TV shows or anyone else's recordings.

> Note: deleting a custom file (the icon next to its name) and [Restore defaults] in the
> "Sound" section delete the files right away, even if you don't save your changes afterwards. [Restore defaults]
> also brings back the "Classic" variant and 100% volume. Deleted files cannot be recovered —
> you have to upload them again.

## 16.5 Questions

These sections decide which questions go into the final and in what order the rounds are played.

### 16.5.1 Question settings

- **"Does the game include a finale?"** — "Yes" or "No" (by default "Yes"). Without a final, the game ends
  after the rounds (→ 3.7). When you turn the final off, the selected final questions go back to the rounds.
- **"Finale questions mode"** — "Random" (the app draws 5 questions) or "Manual" (you choose
  them yourself in the "Questions — Finale" section).
- **"Rounds question order mode"** — "Random" or "Order" (you set it yourself in the
  "Questions — Rounds" section).

![Question settings](zrzut:play-settings-questions)

### 16.5.2 Final questions

With manual selection, tick **exactly 5** final questions — with any other number, the settings cannot
be saved. Final questions are not used in the rounds.

![Choosing the final questions](zrzut:play-settings-finale)
![The final needs 5 questions](zrzut:play-settings-final-need5)

With a random draw, you will see the set in the summary before the game starts, where you can choose
[Reshuffle] (→ 17.2). With a random final and "Order" mode, the final first takes 5 questions
from your rounds list; after [Reshuffle], the previous final questions go back to the end of the list.

### 16.5.3 Round questions

In "Order" mode, in the "Questions — Rounds" section, arrange the order of the questions by dragging (or
with the arrows) — the list contains all questions except the final ones. The rounds use them one after another.
In "Random" mode, the app shuffles the questions before the game — you will see the order in the summary
(→ 17.2). Final questions that were drawn will not be used in the rounds.

![Order of round questions](zrzut:play-settings-rounds)

## 16.6 Additional settings

The "Game settings" section:

| Setting | Default | What it changes |
|---|---|---|
| "Round multipliers" | 1, 1, 1, 2, 3 | How many times the points count in each round. The last multiplier applies to all further rounds (→ 3.2). |
| "Points threshold for finale" | 300 | The team's total score at which the game moves on to the final or ends (→ 3.6). |
| "Finale target (pts)" | 200 | How many points the finalists must score together (→ 4.3). Shown when the final is turned on. |
| "End screen mode" | "Prize amount" | What the end screen shows: "Logo", "Points" or "Prize amount" (only with a final). |
| "Main prize amount" | 25 000 | The prize for reaching the final target. |
| "Prize multiplier (after finale)" | 3 | What the winning team's points from the rounds are multiplied by to calculate the amount. |

![The “Game settings” section](zrzut:play-settings-game)

Multipliers and amounts are positive whole numbers — for example, 0.5 won't work. With an invalid
value the field shows an error at once, and [Save] stops saving and asks you to correct the marked fields.

![An invalid value](zrzut:game-settings-game-invalid)

The last two settings are shown when the game has a final and the end screen shows the prize amount.
The amount on the end screen is the winning team's points from the rounds multiplied by
the "Prize multiplier", and once the final target is reached — increased by the main prize amount (→ 4.4). In a tie, the end
screen shows the logo. Final points are not multiplied; they only determine whether the target was reached.

![Prize amount after the final](zrzut:game-settings-prize)

## 16.7 Saving and using the settings

- You save your changes with the [Save] button. Until you do, the app shows "Unsaved
  changes" and asks you when you leave.
- [Restore defaults] in the top bar restores all settings (and also removes custom sounds);
  the "Display", "Sound" and "Game settings" sections also let you restore just that section.
- If the settings were changed in the meantime in another window, the app warns you before saving.

![Leaving with unsaved changes](zrzut:play-settings-unsaved)
- After a successful save, the [Save] icon shows a check mark. Editing another field clears it.

![Restoring the default settings](zrzut:play-settings-reset-all)

- [Play] takes you straight to the control panel (→ 17). The game must be ready to play
  (→ 7.6).
