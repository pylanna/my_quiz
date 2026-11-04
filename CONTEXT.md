# Live Quiz

A Kahoot-style live quiz game: a Host runs a Game from a CSV of Questions, Players join from their phones, and each Question is timed.

## Language

**Game**:
One live session of a Quiz, from lobby to final results.
_Avoid_: Room, session, match

**Quiz**:
The ordered set of Questions a Host imports from a CSV file.
_Avoid_: Deck, test, exam

**Host**:
The person who creates a Game, imports the Quiz, starts the Game and advances Questions.
_Avoid_: Teacher, admin, moderator

**Player**:
A participant who joins a Game with a Game PIN and a nickname. Has no account.
_Avoid_: User, student, contestant

**Game PIN**:
The short code a Player enters to join a specific Game.
_Avoid_: Room code, join code

**Question**:
A multiple-choice item with 2–4 Options, exactly one correct, and a time limit.
_Avoid_: Item, problem

**Option**:
One selectable answer to a Question.
_Avoid_: Choice, answer (reserve "Answer" for a Player's pick)

**Answer**:
A Player's chosen Option for a Question, counted only if submitted before the time limit.
_Avoid_: Response, submission

**Countdown**:
The time remaining for a Question, starting from the Question's own limit or else the default seconds in Game settings; ends early when every Player has answered.
_Avoid_: Timer

**Game settings**:
The Host's choices for a Game, fixed once it starts: default seconds per Question, base points, and maximum speed bonus.
_Avoid_: Config, options

**Score**:
Points a Player earns for a correct Answer: the base points from Game settings plus a speed bonus that shrinks from its maximum (instant Answer) to 0 (at the deadline). A maximum of 0 means no bonus.
_Avoid_: Points (as the noun for the per-Question result)

**Leaderboard**:
Players ranked by total Score, highest to lowest; ties go to the Player with the lower total time on correct Answers. The Host sees the top 5 after each Question; each Player sees only their own rank and Score. Players with 0 Score are never listed.
_Avoid_: Ranking table, scoreboard

**Podium**:
The top 5 Players on the final Leaderboard, shown at the end of the Game with their total Scores. Players still tied after the tie-break share a rank, so it can show more than 5.
_Avoid_: Winners list
