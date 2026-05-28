// supabase/functions/backfill-2026-draft/index.ts
// One-shot backfill of draft_round + draft_pick for the 2026 NFL Draft.
// Matches by case-insensitive normalized name against nfl_players.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DRAFT_2026 = [
  // Round 1 (picks 1-32)
  { p: 1, n: "Fernando Mendoza", pos: "QB", r: 1 },
  { p: 2, n: "David Bailey", pos: "LB", r: 1 },
  { p: 3, n: "Jeremiyah Love", pos: "RB", r: 1 },
  { p: 4, n: "Carnell Tate", pos: "WR", r: 1 },
  { p: 5, n: "Arvell Reese", pos: "LB", r: 1 },
  { p: 6, n: "Mansoor Delane", pos: "DB", r: 1 },
  { p: 7, n: "Sonny Styles", pos: "LB", r: 1 },
  { p: 8, n: "Jordyn Tyson", pos: "WR", r: 1 },
  { p: 9, n: "Spencer Fano", pos: "OT", r: 1 },
  { p: 10, n: "Francis Mauigoa", pos: "OT", r: 1 },
  { p: 11, n: "Caleb Downs", pos: "S", r: 1 },
  { p: 12, n: "Kadyn Proctor", pos: "OT", r: 1 },
  { p: 13, n: "Ty Simpson", pos: "QB", r: 1 },
  { p: 14, n: "Olaivavega Ioane", pos: "G", r: 1 },
  { p: 15, n: "Rueben Bain Jr.", pos: "EDGE", r: 1 },
  { p: 16, n: "Kenyon Sadiq", pos: "TE", r: 1 },
  { p: 17, n: "Blake Miller", pos: "OT", r: 1 },
  { p: 18, n: "Caleb Banks", pos: "DT", r: 1 },
  { p: 19, n: "Monroe Freeling", pos: "OT", r: 1 },
  { p: 20, n: "Makai Lemon", pos: "WR", r: 1 },
  { p: 21, n: "Max Iheanachor", pos: "OT", r: 1 },
  { p: 22, n: "Akheem Mesidor", pos: "EDGE", r: 1 },
  { p: 23, n: "Malachi Lawrence", pos: "EDGE", r: 1 },
  { p: 24, n: "KC Concepcion", pos: "WR", r: 1 },
  { p: 25, n: "Dillon Thieneman", pos: "S", r: 1 },
  { p: 26, n: "Keylan Rutledge", pos: "G", r: 1 },
  { p: 27, n: "Chris Johnson", pos: "CB", r: 1 },
  { p: 28, n: "Caleb Lomu", pos: "OT", r: 1 },
  { p: 29, n: "Peter Woods", pos: "DT", r: 1 },
  { p: 30, n: "Omar Cooper Jr.", pos: "WR", r: 1 },
  { p: 31, n: "Keldric Faulk", pos: "EDGE", r: 1 },
  { p: 32, n: "Jadarian Price", pos: "RB", r: 1 },
  // Round 2 (picks 33-64)
  { p: 33, n: "De'Zhaun Stribling", pos: "WR", r: 2 },
  { p: 34, n: "Chase Bisontis", pos: "G", r: 2 },
  { p: 35, n: "TJ Parker", pos: "EDGE", r: 2 },
  { p: 36, n: "Kayden McDonald", pos: "DT", r: 2 },
  { p: 37, n: "Colton Hood", pos: "CB", r: 2 },
  { p: 38, n: "Treydan Stukes", pos: "S", r: 2 },
  { p: 39, n: "Denzel Boston", pos: "WR", r: 2 },
  { p: 40, n: "R Mason Thomas", pos: "EDGE", r: 2 },
  { p: 41, n: "Cashius Howell", pos: "EDGE", r: 2 },
  { p: 42, n: "Christen Miller", pos: "DT", r: 2 },
  { p: 43, n: "Jacob Rodriguez", pos: "LB", r: 2 },
  { p: 44, n: "Derrick Moore", pos: "EDGE", r: 2 },
  { p: 45, n: "Zion Young", pos: "EDGE", r: 2 },
  { p: 46, n: "Josiah Trotter", pos: "LB", r: 2 },
  { p: 47, n: "Germie Bernard", pos: "WR", r: 2 },
  { p: 48, n: "Avieon Terrell", pos: "CB", r: 2 },
  { p: 49, n: "Lee Hunter", pos: "DT", r: 2 },
  { p: 50, n: "D'Angelo Ponds", pos: "CB", r: 2 },
  { p: 51, n: "Jake Golday", pos: "LB", r: 2 },
  { p: 52, n: "Brandon Cisse", pos: "CB", r: 2 },
  { p: 53, n: "CJ Allen", pos: "LB", r: 2 },
  { p: 54, n: "Eli Stowers", pos: "TE", r: 2 },
  { p: 55, n: "Gabe Jacas", pos: "EDGE", r: 2 },
  { p: 56, n: "Nate Boerkircher", pos: "TE", r: 2 },
  { p: 57, n: "Logan Jones", pos: "C", r: 2 },
  { p: 58, n: "Emmanuel McNeil-Warren", pos: "S", r: 2 },
  { p: 59, n: "Marlin Klein", pos: "TE", r: 2 },
  { p: 60, n: "Anthony Hill Jr.", pos: "LB", r: 2 },
  { p: 61, n: "Max Klare", pos: "TE", r: 2 },
  { p: 62, n: "Davison Igbinosun", pos: "CB", r: 2 },
  { p: 63, n: "Jake Slaughter", pos: "C", r: 2 },
  { p: 64, n: "Bud Clark", pos: "S", r: 2 },
  // Round 3 (picks 65-100)
  { p: 65, n: "Carson Beck", pos: "QB", r: 3 },
  { p: 66, n: "Tyler Onyedim", pos: "DT", r: 3 },
  { p: 67, n: "Keyron Crawford", pos: "EDGE", r: 3 },
  { p: 68, n: "Markell Bell", pos: "OT", r: 3 },
  { p: 69, n: "Sam Roush", pos: "TE", r: 3 },
  { p: 70, n: "Romello Height", pos: "EDGE", r: 3 },
  { p: 71, n: "Antonio Williams", pos: "WR", r: 3 },
  { p: 72, n: "Tacario Davis", pos: "CB", r: 3 },
  { p: 73, n: "Oscar Delp", pos: "TE", r: 3 },
  { p: 74, n: "Malachi Fields", pos: "WR", r: 3 },
  { p: 75, n: "Caleb Douglas", pos: "WR", r: 3 },
  { p: 76, n: "Drew Allar", pos: "QB", r: 3 },
  { p: 77, n: "Chris McLellan", pos: "DT", r: 3 },
  { p: 78, n: "AJ Haulcy", pos: "S", r: 3 },
  { p: 79, n: "Zachariah Branch", pos: "WR", r: 3 },
  { p: 80, n: "Ja'Kobi Lane", pos: "WR", r: 3 },
  { p: 81, n: "Albert Regis", pos: "DT", r: 3 },
  { p: 82, n: "Domonique Orange", pos: "DT", r: 3 },
  { p: 83, n: "Chris Brazzell II", pos: "WR", r: 3 },
  { p: 84, n: "Ted Hurst", pos: "WR", r: 3 },
  { p: 85, n: "Daylen Everette", pos: "CB", r: 3 },
  { p: 86, n: "Austin Barber", pos: "OT", r: 3 },
  { p: 87, n: "Will Kacmarek", pos: "TE", r: 3 },
  { p: 88, n: "Emmanuel Pregnon", pos: "G", r: 3 },
  { p: 89, n: "Zavion Thomas", pos: "WR", r: 3 },
  { p: 90, n: "Kaelon Black", pos: "RB", r: 3 },
  { p: 91, n: "Trey Zuhn III", pos: "C", r: 3 },
  { p: 92, n: "Jaishawn Barham", pos: "EDGE", r: 3 },
  { p: 93, n: "Keagan Trost", pos: "OT", r: 3 },
  { p: 94, n: "Chris Bell", pos: "WR", r: 3 },
  { p: 95, n: "Eli Raridon", pos: "TE", r: 3 },
  { p: 96, n: "Gennings Dunker", pos: "OT", r: 3 },
  { p: 97, n: "Caleb Tiernan", pos: "OT", r: 3 },
  { p: 98, n: "Jakobe Thomas", pos: "S", r: 3 },
  { p: 99, n: "Julian Neal", pos: "CB", r: 3 },
  { p: 100, n: "Jalen Huskey", pos: "CB", r: 3 },
  // Round 4 (picks 101-140)
  { p: 101, n: "Jermod McCoy", pos: "CB", r: 4 },
  { p: 102, n: "Jude Bowry", pos: "OT", r: 4 },
  { p: 103, n: "Darrell Jackson Jr.", pos: "DT", r: 4 },
  { p: 104, n: "Caleb Proctor", pos: "WR", r: 4 },
  { p: 105, n: "Brenen Thompson", pos: "WR", r: 4 },
  { p: 106, n: "Febechi Nwaiwu", pos: "G", r: 4 },
  { p: 107, n: "Gracen Halton", pos: "DT", r: 4 },
  { p: 108, n: "Jonah Coleman", pos: "RB", r: 4 },
  { p: 109, n: "Jadon Canady", pos: "S", r: 4 },
  { p: 110, n: "Cade Klubnik", pos: "QB", r: 4 },
  { p: 111, n: "Kage Casey", pos: "OT", r: 4 },
  { p: 112, n: "Drew Shelton", pos: "OT", r: 4 },
  { p: 113, n: "Jalen Farmer", pos: "G", r: 4 },
  { p: 114, n: "Devin Moore", pos: "CB", r: 4 },
  { p: 115, n: "Elijah Sarratt", pos: "WR", r: 4 },
  { p: 116, n: "Keionte Scott", pos: "CB", r: 4 },
  { p: 117, n: "Travis Burke", pos: "OT", r: 4 },
  { p: 118, n: "Jimmy Rolder", pos: "LB", r: 4 },
  { p: 119, n: "Wesley Williams", pos: "EDGE", r: 4 },
  { p: 120, n: "Dani Dennis-Sutton", pos: "EDGE", r: 4 },
  { p: 121, n: "Kaden Wetjen", pos: "WR", r: 4 },
  { p: 122, n: "Mike Washington Jr.", pos: "RB", r: 4 },
  { p: 123, n: "Wade Woodaz", pos: "LB", r: 4 },
  { p: 124, n: "Malik Muhammad", pos: "CB", r: 4 },
  { p: 125, n: "Skyler Bell", pos: "WR", r: 4 },
  { p: 126, n: "Kaleb Elarms-Orr", pos: "LB", r: 4 },
  { p: 127, n: "Carver Willis", pos: "OT", r: 4 },
  { p: 128, n: "Connor Lew", pos: "C", r: 4 },
  { p: 129, n: "Will Lee III", pos: "CB", r: 4 },
  { p: 130, n: "Trey Moore", pos: "EDGE", r: 4 },
  { p: 131, n: "Genesis Smith", pos: "S", r: 4 },
  { p: 132, n: "Jeremiah Wright", pos: "G", r: 4 },
  { p: 133, n: "Matthew Hibner", pos: "TE", r: 4 },
  { p: 134, n: "Kendal Daniels", pos: "LB", r: 4 },
  { p: 135, n: "Bryce Boettcher", pos: "LB", r: 4 },
  { p: 136, n: "Bryce Lance", pos: "WR", r: 4 },
  { p: 137, n: "LT Overton", pos: "EDGE", r: 4 },
  { p: 138, n: "Kyle Louis", pos: "S", r: 4 },
  { p: 139, n: "Ephesians Prysock", pos: "CB", r: 4 },
  { p: 140, n: "Colbie Young", pos: "WR", r: 4 },
  // Round 5 (picks 141-181)
  { p: 141, n: "Kamari Ramsey", pos: "S", r: 5 },
  { p: 142, n: "Fernando Carmona", pos: "G", r: 5 },
  { p: 143, n: "Reggie Virgil", pos: "WR", r: 5 },
  { p: 144, n: "Sam Hecht", pos: "C", r: 5 },
  { p: 145, n: "Nick Barrett", pos: "DT", r: 5 },
  { p: 146, n: "Parker Brailsford", pos: "C", r: 5 },
  { p: 147, n: "Joshua Josephs", pos: "EDGE", r: 5 },
  { p: 148, n: "Beau Stephens", pos: "G", r: 5 },
  { p: 149, n: "Justin Jefferson", pos: "LB", r: 5 },
  { p: 150, n: "Dalton Johnson", pos: "S", r: 5 },
  { p: 151, n: "Zakee Wheatley", pos: "S", r: 5 },
  { p: 152, n: "Justin Joly", pos: "TE", r: 5 },
  { p: 153, n: "Jager Burton", pos: "C", r: 5 },
  { p: 154, n: "Jaden Dugger", pos: "LB", r: 5 },
  { p: 155, n: "DeMonte Capehart", pos: "DT", r: 5 },
  { p: 156, n: "George Gumbs Jr.", pos: "EDGE", r: 5 },
  { p: 157, n: "Keith Abney II", pos: "CB", r: 5 },
  { p: 158, n: "Michael Taaffe", pos: "S", r: 5 },
  { p: 159, n: "Max Bredeson", pos: "TE", r: 5 },
  { p: 160, n: "Billy Schrauth", pos: "G", r: 5 },
  { p: 161, n: "Emmett Johnson", pos: "RB", r: 5 },
  { p: 162, n: "Chandler Rivers", pos: "CB", r: 5 },
  { p: 163, n: "Charles Demmings", pos: "CB", r: 5 },
  { p: 164, n: "Tanner Koziol", pos: "TE", r: 5 },
  { p: 165, n: "Nicholas Singleton", pos: "RB", r: 5 },
  { p: 166, n: "Keyshaun Elliott", pos: "LB", r: 5 },
  { p: 167, n: "Jalon Kilgore", pos: "S", r: 5 },
  { p: 168, n: "Kendrick Law", pos: "WR", r: 5 },
  { p: 169, n: "Riley Nowakowski", pos: "TE", r: 5 },
  { p: 170, n: "Joe Royer", pos: "TE", r: 5 },
  { p: 171, n: "Karon Prunty", pos: "CB", r: 5 },
  { p: 172, n: "Lorenzo Styles Jr.", pos: "S", r: 5 },
  { p: 173, n: "Josh Cuevas", pos: "TE", r: 5 },
  { p: 174, n: "Adam Randall", pos: "RB", r: 5 },
  { p: 175, n: "Hezekiah Masses", pos: "CB", r: 5 },
  { p: 176, n: "Cyrus Allen", pos: "WR", r: 5 },
  { p: 177, n: "Kevin Coleman Jr.", pos: "WR", r: 5 },
  { p: 178, n: "Cole Payton", pos: "QB", r: 5 },
  { p: 179, n: "Enrique Cruz Jr.", pos: "OT", r: 5 },
  { p: 180, n: "Seydou Traore", pos: "TE", r: 5 },
  { p: 181, n: "Zane Durant", pos: "DT", r: 5 },
  // Round 6 (picks 182-216)
  { p: 182, n: "Taylen Green", pos: "QB", r: 6 },
  { p: 183, n: "Karson Sharar", pos: "LB", r: 6 },
  { p: 184, n: "Jackie Marshall", pos: "DT", r: 6 },
  { p: 185, n: "Bauer Sharp", pos: "TE", r: 6 },
  { p: 186, n: "Bobby Jamison-Travis", pos: "DT", r: 6 },
  { p: 187, n: "Kaytron Allen", pos: "RB", r: 6 },
  { p: 188, n: "Anez Cooper", pos: "G", r: 6 },
  { p: 189, n: "Brian Parker II", pos: "OL", r: 6 },
  { p: 190, n: "Barrion Brown", pos: "WR", r: 6 },
  { p: 191, n: "Josh Cameron", pos: "WR", r: 6 },
  { p: 192, n: "J.C. Davis", pos: "OT", r: 6 },
  { p: 193, n: "Jack Kelly", pos: "LB", r: 6 },
  { p: 194, n: "Pat Coogan", pos: "C", r: 6 },
  { p: 195, n: "Malik Benson", pos: "WR", r: 6 },
  { p: 196, n: "Dametrious Crownover", pos: "OT", r: 6 },
  { p: 197, n: "CJ Daniels", pos: "WR", r: 6 },
  { p: 198, n: "Demond Claiborne", pos: "RB", r: 6 },
  { p: 199, n: "Emmanuel Henderson Jr.", pos: "WR", r: 6 },
  { p: 200, n: "DJ Campbell", pos: "G", r: 6 },
  { p: 201, n: "Domani Jackson", pos: "CB", r: 6 },
  { p: 202, n: "Logan Taylor", pos: "G", r: 6 },
  { p: 203, n: "CJ Williams", pos: "WR", r: 6 },
  { p: 204, n: "Lewis Bond", pos: "WR", r: 6 },
  { p: 205, n: "Skyler Gill-Howard", pos: "DT", r: 6 },
  { p: 206, n: "Alex Harkey", pos: "G", r: 6 },
  { p: 207, n: "Micah Morris", pos: "G", r: 6 },
  { p: 208, n: "Anterio Thompson", pos: "DT", r: 6 },
  { p: 209, n: "Matt Gulbin", pos: "C", r: 6 },
  { p: 210, n: "Gabriel Rubio", pos: "DT", r: 6 },
  { p: 211, n: "Ryan Eckley", pos: "P", r: 6 },
  { p: 212, n: "Namdi Obiazor", pos: "LB", r: 6 },
  { p: 213, n: "Jordan van den Berg", pos: "DT", r: 6 },
  { p: 214, n: "Caden Curry", pos: "EDGE", r: 6 },
  { p: 215, n: "Harold Perkins Jr.", pos: "LB", r: 6 },
  { p: 216, n: "Trey Smack", pos: "K", r: 6 },
  // Round 7 (picks 217-257)
  { p: 217, n: "Jayden Williams", pos: "OT", r: 7 },
  { p: 218, n: "Anthony Smith", pos: "WR", r: 7 },
  { p: 219, n: "TJ Hall", pos: "CB", r: 7 },
  { p: 220, n: "Toriano Pride Jr.", pos: "CB", r: 7 },
  { p: 221, n: "Jack Endries", pos: "TE", r: 7 },
  { p: 222, n: "Tyre West", pos: "EDGE", r: 7 },
  { p: 223, n: "Athan Kaliakmanis", pos: "QB", r: 7 },
  { p: 224, n: "Robert Spears-Jennings", pos: "S", r: 7 },
  { p: 225, n: "Jaren Kanak", pos: "TE", r: 7 },
  { p: 226, n: "Landon Robinson", pos: "DT", r: 7 },
  { p: 227, n: "Jackson Kuwatch", pos: "LB", r: 7 },
  { p: 228, n: "VJ Payne", pos: "S", r: 7 },
  { p: 229, n: "Brandon Cleveland", pos: "DT", r: 7 },
  { p: 230, n: "Eli Heidenreich", pos: "RB", r: 7 },
  { p: 231, n: "Ethan Onianwa", pos: "OT", r: 7 },
  { p: 232, n: "Tim Keenan III", pos: "DT", r: 7 },
  { p: 233, n: "Zach Durfee", pos: "EDGE", r: 7 },
  { p: 234, n: "Behren Morton", pos: "QB", r: 7 },
  { p: 235, n: "Gavin Gerhardt", pos: "C", r: 7 },
  { p: 236, n: "Andre Fuller", pos: "CB", r: 7 },
  { p: 237, n: "Seth McGowan", pos: "RB", r: 7 },
  { p: 238, n: "Max Llewellyn", pos: "EDGE", r: 7 },
  { p: 239, n: "Tommy Doman", pos: "P", r: 7 },
  { p: 240, n: "Parker Hughes", pos: "LB", r: 7 },
  { p: 241, n: "Ar'maj Reed-Adams", pos: "G", r: 7 },
  { p: 242, n: "Deven Eastern", pos: "DT", r: 7 },
  { p: 243, n: "Aiden Fisher", pos: "LB", r: 7 },
  { p: 244, n: "Cole Wisniewski", pos: "S", r: 7 },
  { p: 245, n: "Jam Miller", pos: "RB", r: 7 },
  { p: 246, n: "Miles Scott", pos: "S", r: 7 },
  { p: 247, n: "Quintayvious Hutchins", pos: "EDGE", r: 7 },
  { p: 248, n: "Carsen Ryan", pos: "TE", r: 7 },
  { p: 249, n: "Garrett Nussmeier", pos: "QB", r: 7 },
  { p: 250, n: "Rayshaun Benny", pos: "DT", r: 7 },
  { p: 251, n: "Uar Bernard", pos: "DT", r: 7 },
  { p: 252, n: "Keyshawn James-Newby", pos: "EDGE", r: 7 },
  { p: 253, n: "Evan Beerntsen", pos: "G", r: 7 },
  { p: 254, n: "Deion Burks", pos: "WR", r: 7 },
  { p: 255, n: "Michael Dansby", pos: "CB", r: 7 },
  { p: 256, n: "Dallen Bentley", pos: "TE", r: 7 },
  { p: 257, n: "Red Murdock", pos: "LB", r: 7 },
];


const PICK_TO_TEAM: Record<number, string> = {
  1: "LV",
  2: "NYJ",
  3: "ARI",
  4: "TEN",
  5: "NYG",
  6: "KC",
  7: "WAS",
  8: "NO",
  9: "CLE",
  10: "NYG",
  11: "DAL",
  12: "MIA",
  13: "LAR",
  14: "BAL",
  15: "TB",
  16: "NYJ",
  17: "DET",
  18: "MIN",
  19: "CAR",
  20: "PHI",
  21: "PIT",
  22: "LAC",
  23: "DAL",
  24: "CLE",
  25: "CHI",
  26: "HOU",
  27: "MIA",
  28: "NE",
  29: "KC",
  30: "NYJ",
  31: "TEN",
  32: "SEA",
  33: "SF",
  34: "ARI",
  35: "BUF",
  36: "HOU",
  37: "NYG",
  38: "LV",
  39: "CLE",
  40: "KC",
  41: "CIN",
  42: "NO",
  43: "MIA",
  44: "DET",
  45: "BAL",
  46: "TB",
  47: "PIT",
  48: "ATL",
  49: "CAR",
  50: "NYJ",
  51: "MIN",
  52: "GB",
  53: "IND",
  54: "PHI",
  55: "NE",
  56: "JAX",
  57: "CHI",
  58: "CLE",
  59: "HOU",
  60: "TEN",
  61: "LAR",
  62: "BUF",
  63: "LAC",
  64: "SEA",
  65: "ARI",
  66: "DEN",
  67: "LV",
  68: "PHI",
  69: "CHI",
  70: "SF",
  71: "WAS",
  72: "CIN",
  73: "NO",
  74: "KC",
  75: "MIA",
  76: "PIT",
  77: "TB",
  78: "IND",
  79: "ATL",
  80: "BAL",
  81: "JAX",
  82: "MIN",
  83: "CAR",
  84: "TB",
  85: "PIT",
  86: "CLE",
  87: "MIA",
  88: "JAX",
  89: "CHI",
  90: "SF",
  91: "LV",
  92: "DAL",
  93: "LAR",
  94: "MIA",
  95: "NE",
  96: "PIT",
  97: "MIN",
  98: "MIN",
  99: "SEA",
  100: "JAX",
  101: "LV",
  102: "BUF",
  103: "NYJ",
  104: "ARI",
  105: "LAC",
  106: "HOU",
  107: "SF",
  108: "DEN",
  109: "KC",
  110: "NYJ",
  111: "DEN",
  112: "DAL",
  113: "IND",
  114: "DAL",
  115: "BAL",
  116: "TB",
  117: "LAC",
  118: "DET",
  119: "CAR",
  120: "GB",
  121: "PIT",
  122: "LV",
  123: "HOU",
  124: "CHI",
  125: "BUF",
  126: "BUF",
  127: "SF",
  128: "CIN",
  129: "CAR",
  130: "MIA",
  131: "LAC",
  132: "NO",
  133: "BAL",
  134: "ATL",
  135: "IND",
  136: "NO",
  137: "DAL",
  138: "MIA",
  139: "SF",
  140: "CIN",
  141: "HOU",
  142: "TEN",
  143: "ARI",
  144: "CAR",
  145: "LAC",
  146: "CLE",
  147: "WAS",
  148: "SEA",
  149: "CLE",
  150: "LV",
  151: "CAR",
  152: "DEN",
  153: "GB",
  154: "SF",
  155: "TB",
  156: "IND",
  157: "DET",
  158: "MIA",
  159: "MIN",
  160: "TB",
  161: "KC",
  162: "BAL",
  163: "MIN",
  164: "JAX",
  165: "TEN",
  166: "CHI",
  167: "BUF",
  168: "DET",
  169: "PIT",
  170: "CLE",
  171: "NE",
  172: "NO",
  173: "BAL",
  174: "BAL",
  175: "LV",
  176: "KC",
  177: "MIA",
  178: "PHI",
  179: "SF",
  180: "MIA",
  181: "BUF",
  182: "CLE",
  183: "ARI",
  184: "TEN",
  185: "TB",
  186: "NYG",
  187: "WAS",
  188: "NYJ",
  189: "CIN",
  190: "NO",
  191: "JAX",
  192: "NYG",
  193: "NYG",
  194: "TEN",
  195: "LV",
  196: "NE",
  197: "LAR",
  198: "MIN",
  199: "SEA",
  200: "MIA",
  201: "GB",
  202: "LAC",
  203: "JAX",
  204: "HOU",
  205: "DET",
  206: "LAC",
  207: "PHI",
  208: "ATL",
  209: "WAS",
  210: "PIT",
  211: "BAL",
  212: "NE",
  213: "CHI",
  214: "IND",
  215: "ATL",
  216: "GB",
  217: "ARI",
  218: "DAL",
  219: "NO",
  220: "BUF",
  221: "CIN",
  222: "DET",
  223: "WAS",
  224: "PIT",
  225: "TEN",
  226: "CIN",
  227: "CAR",
  228: "NYJ",
  229: "LV",
  230: "PIT",
  231: "ATL",
  232: "LAR",
  233: "JAX",
  234: "NE",
  235: "MIN",
  236: "SEA",
  237: "IND",
  238: "MIA",
  239: "BUF",
  240: "JAX",
  241: "BUF",
  242: "SEA",
  243: "HOU",
  244: "PHI",
  245: "NE",
  246: "DEN",
  247: "NE",
  248: "CLE",
  249: "KC",
  250: "BAL",
  251: "PHI",
  252: "PHI",
  253: "BAL",
  254: "IND",
  255: "SEA",
  256: "DEN",
  257: "DEN",
};

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const startedAt = Date.now();

    // v2026-05-07: restore mode. Runs a one-shot fix for rows that an
    // earlier (pre-position-guard) version of this function corrupted.
    // Justin Jefferson WR (00-0036322) was overwritten by 2026 LB rookie
    // of the same name. Resets to verified pre-corruption state.
    const url = new URL(req.url);
    if (url.searchParams.get('mode') === 'restore') {
      const restorations: Array<{ gsis_id: string; patch: Record<string, unknown> }> = [
        {
          gsis_id: '00-0036322',
          patch: {
            full_name:    'Justin Jefferson',
            first_name:   'Justin',
            last_name:    'Jefferson',
            position:     'WR',
            team:         'MIN',
            age:          26,
            rookie_year:  2020,
            draft_year:   2020,
            draft_round:  1,
            draft_pick:   22,
            is_active:    true,
          },
        },
      ];
      const results: Array<{ gsis_id: string; ok: boolean; error?: string }> = [];
      for (const r of restorations) {
        const { error } = await supabase
          .from('nfl_players')
          .update(r.patch)
          .eq('gsis_id', r.gsis_id);
        results.push({ gsis_id: r.gsis_id, ok: !error, error: error?.message });
      }
      return new Response(JSON.stringify({ ok: true, mode: 'restore', results }), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Pull ALL nfl_players to attempt name matching across the whole table
    // (not just draft_year=2026, since nflverse may not have synced these yet).
    const allPlayers: any[] = [];
    const CHUNK = 1000;
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('nfl_players')
        .select('gsis_id, full_name, position')
        .range(offset, offset + CHUNK - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allPlayers.push(...data);
      if (data.length < CHUNK) break;
      offset += CHUNK;
      if (offset > 10000) break;
    }

    const byName = new Map<string, { gsis_id: string; position: string }>();
    for (const p of allPlayers) {
      if (p.full_name) byName.set(normalize(p.full_name), { gsis_id: p.gsis_id, position: p.position });
    }

    let updated = 0;
    let inserted = 0;
    const failures: string[] = [];

    for (const pick of DRAFT_2026) {
      const key = normalize(pick.n);
      const existing = byName.get(key);
      const team = PICK_TO_TEAM[pick.p] ?? null;

      // v2026-05-07: position-match guard. Without this, a 2026 LB rookie
      // named "Justin Jefferson" overwrites the real WR Justin Jefferson's
      // row. If the matched existing row has a different position, treat
      // as a no-match and INSERT a synthetic row instead.
      const positionMatches = existing && existing.position === pick.pos;

      if (positionMatches) {
        // Update existing row with draft data
        const { error } = await supabase
          .from('nfl_players')
          .update({
            draft_year: 2026,
            draft_round: pick.r,
            draft_pick: pick.p,
            rookie_year: 2026,
            team,
          })
          .eq('gsis_id', existing.gsis_id);
        if (error) {
          failures.push(`update ${pick.n}: ${error.message}`);
        } else {
          updated++;
        }
      } else {
        // Insert new row with synthetic gsis_id
        const synthId = `2026_pick_${String(pick.p).padStart(3, '0')}`;
        // Split full_name into first/last (NOT NULL columns).
        // Handle "TJ Parker", "Rueben Bain Jr.", "J.C. Davis" by taking
        // first whitespace token as first_name and the rest as last_name.
        const spaceIdx = pick.n.indexOf(' ');
        const firstName = spaceIdx > 0 ? pick.n.slice(0, spaceIdx) : pick.n;
        const lastName  = spaceIdx > 0 ? pick.n.slice(spaceIdx + 1) : pick.n;
        // Estimate age based on draft round (2026 college players are
        // typically 21-23). R1-2: 22, R3-4: 23, R5+: 24.
        let estimatedAge = 22;
        if (pick.r === 3 || pick.r === 4) estimatedAge = 23;
        else if (pick.r >= 5) estimatedAge = 24;
        const { error } = await supabase
          .from('nfl_players')
          .insert({
            gsis_id: synthId,
            full_name: pick.n,
            first_name: firstName,
            last_name: lastName,
            position: pick.pos,
            team,
            age: estimatedAge,
            draft_year: 2026,
            draft_round: pick.r,
            draft_pick: pick.p,
            rookie_year: 2026,
            is_active: true,
            years_exp: 0,
          });
        if (error) {
          failures.push(`insert ${pick.n}: ${error.message}`);
        } else {
          inserted++;
        }
      }
    }

    const duration = Math.round((Date.now() - startedAt) / 1000);
    return new Response(JSON.stringify({
      ok: true,
      total_picks: DRAFT_2026.length,
      updated,
      inserted,
      failures: failures.length,
      failure_sample: failures.slice(0, 10),
      duration_seconds: duration,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('backfill-2026-draft error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message ?? String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
