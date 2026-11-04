export interface Question {
  text: string;
  options: string[]; // 2-4 entries
  correct: number; // index into options
  seconds: number | null; // own time limit; null → the Game's default
}
