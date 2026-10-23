# Quarantine Line

A real-time strategy game for the browser. You are the government of a small country on the morning the
first infected case is found, and you have to hold the country together until Day 50.

**[Play it in your browser](https://cmullis1.github.io/quarantine-line/)** (mouse and keyboard, no install)

![A horde of the dead piles up against a wall at a border crossing while two watchtowers fire on it](screenshots/play.gif)

## What it does

You are not a general. You build walls and train squads, but the choices that decide the game are who
gets across the border, what the public is told, which towns are saved and which are given up, and how
much freedom you trade for order.

- **The border is a policy.** Refugees walk to your road crossings. Let them in and your population
  and workforce grow, but some of them carry the infection. Screen them at checkpoints, close the
  border and leave them stranded, or worse. Every stance has a cost you can see.
- **The infection hides.** Each town has a true case count and a reported one. Quarantine teams,
  field hospitals and testing raise what you can see; low public trust means people hide their sick.
  Left alone, an outbreak grows until the dead walk out into the streets.
- **The dead behave like a force of nature.** Hordes follow noise and route around gaps in your walls.
  Against a solid wall they pile up on each other until the top of the pile spills over. Runners,
  brutes, howlers and the drowned (who walk out of the sea) each break a different defensive habit.
- **Trust and Order.** Two meters measure whether people cooperate and whether they comply. Force buys
  order and spends trust. If either reaches zero, the government falls.
- **Hard calls.** Scripted decisions across four acts (cover up the first case or go public, approve an
  unproven vaccine, stage a televised battle) and a cabinet that asks for things with deadlines. The
  ending you get depends on the record you leave.

There is a 12-minute Basic Training mission that teaches every system, a 50-day campaign in the
fictional Republic of Valdmark, and an endless Sandbox on a randomly generated country, each at three
difficulties. Under the hood: about twenty buildings, eleven unit types, a research tree, laws, an
economy where producers need workers from the towns, weather, day and night, and a procedural music
score that follows the state of the war.

![The first decision of the campaign: go public about the first case, or suppress it](screenshots/first-decision.png)

![Watchtowers and a floodlight behind a wall at the Drovno crossing as the dead arrive](screenshots/defending-the-line.png)

## How to run it

The easiest way is the [live version](https://cmullis1.github.io/quarantine-line/). The in-game Field
Manual (F10, or the `?` button) lists every control.

To run it locally you need Python 3 (any static file server works, but the page has to be served, not
opened as a file):

```
python serve.py
```

Then open http://localhost:28802. The game loads Three.js and its fonts from a CDN, so it needs an
internet connection.

There is no build step: it is plain JavaScript modules, HTML and CSS. The simulation in `js/sim/` has
no rendering or browser code, so it also runs under Node. With Node 22 or newer:

```
# the automated tests
npm test

# one bot game, printed day by day
node tools/headless.mjs --bot balanced --days 50 --difficulty veteran

# a balance matrix: bots x difficulties x seeds
node tools/balance.mjs --bots idle,balanced,turtle --diffs recruit,veteran --seeds 4
```

## How it was built

I came up with the idea (a country defending itself against a zombie pandemic, from the day the
infection is discovered), set the quality bar, and then handed the design decisions to Claude Code as
an experiment in how far it could take a game on its own. Claude Code researched the genre, wrote the
design, and wrote nearly all of the code. I was the play-tester and the ears: I played it and listened
to the music in rounds, said what felt wrong (the map felt too small, buttons flashed, cars drove
across fields, the melody was boring and had a shrill note in it), and each round of feedback was
logged and fixed.

The testing is what makes a project like this hold together:

- 223 automated tests cover the simulation (spread, pathfinding, pile-ups, economy, laws, saves, music).
- Bots with different play styles play the whole campaign headlessly. Each balance pass runs them
  across difficulties and random seeds, so a change that makes the game too easy or too hard shows up
  as numbers, not a feeling.
- 23 scripted play-tests (kept in the private working repo) drive the real game in a browser with real
  mouse and keyboard input and take screenshots at both of my monitor sizes, using
  [Eyes](https://github.com/cmullis1/eyes), another project in this portfolio.

It was built in two days of sessions in October 2026, in plain JavaScript and
[Three.js](https://threejs.org/). Every model and sound is generated in code: the game ships no image
or audio files.

## License

[MIT](LICENSE)
