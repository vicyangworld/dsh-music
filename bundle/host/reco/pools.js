/** 探索轴代表曲目池（传统算法的「领域代表歌手」候选源，Chief 设计要点 3 允许）。
 * 全部为公开可查证的知名作品；每首仍必须经 verify.js 的 MusicBrainz 核实后才进入推荐，
 * 未核实/查无此曲的条目自动跳过并由同类替补顶上，绝不输出幻觉歌曲。
 * 轴值选择避开画像（profileValues），池内顺序按批次游标轮换，保证批间多样性。 */

export const GENRE_POOLS = {
  jazz: [
    { artist: 'Miles Davis', title: 'So What' },
    { artist: 'Dave Brubeck', title: 'Take Five' },
    { artist: 'John Coltrane', title: 'Blue Train' },
    { artist: 'Bill Evans', title: 'Waltz for Debby' },
  ],
  classical: [
    { artist: '坂本龍一', title: 'Merry Christmas Mr. Lawrence' },
    { artist: 'Ludovico Einaudi', title: 'Nuvole Bianche' },
    { artist: '久石讓', title: 'Summer' },
    { artist: 'Erik Satie', title: 'Gnossienne No. 1' },
  ],
  electronic: [
    { artist: 'Daft Punk', title: 'Get Lucky' },
    { artist: 'Kraftwerk', title: 'The Model' },
    { artist: 'Aphex Twin', title: 'Avril 14th' },
    { artist: 'Boards of Canada', title: 'Roygbiv' },
  ],
  blues: [
    { artist: 'B.B. King', title: 'The Thrill Is Gone' },
    { artist: 'Muddy Waters', title: 'Mannish Boy' },
    { artist: 'Stevie Ray Vaughan', title: 'Pride and Joy' },
  ],
  reggae: [
    { artist: 'Bob Marley', title: 'Three Little Birds' },
    { artist: 'Bob Marley', title: 'Redemption Song' },
    { artist: 'Toots and the Maytals', title: 'Pressure Drop' },
  ],
  soul: [
    { artist: 'Otis Redding', title: "(Sittin' On) The Dock of the Bay" },
    { artist: 'Aretha Franklin', title: 'Respect' },
    { artist: 'Sam Cooke', title: 'A Change Is Gonna Come' },
  ],
  folk: [
    { artist: 'Bob Dylan', title: "Blowin' in the Wind" },
    { artist: 'Simon & Garfunkel', title: 'The Sound of Silence' },
    { artist: '李健', title: '貝加爾湖畔' },
  ],
  metal: [
    { artist: 'Metallica', title: 'Nothing Else Matters' },
    { artist: 'Iron Maiden', title: 'The Trooper' },
    { artist: 'Black Sabbath', title: 'Paranoid' },
  ],
  funk: [
    { artist: 'Earth, Wind & Fire', title: 'September' },
    { artist: 'Stevie Wonder', title: 'Superstition' },
    { artist: 'James Brown', title: 'Get Up (I Feel Like Being a) Sex Machine' },
  ],
  ambient: [
    { artist: 'Brian Eno', title: 'An Ending (Ascent)' },
    { artist: 'Sigur Rós', title: 'Hoppípolla' },
    { artist: 'Moby', title: 'Porcelain' },
  ],
  // 八期②：对齐欢迎页 genreOptions 15 个流派（织音 client 已扩到 15）。
  // 'hip hop' 保留空格键名，与 style.js / MB tag 口径一致（客户端传 'hip hop'）。
  rock: [
    { artist: 'The Rolling Stones', title: 'Paint It Black' },
    { artist: 'Led Zeppelin', title: 'Stairway to Heaven' },
    { artist: 'Nirvana', title: 'Smells Like Teen Spirit' },
  ],
  pop: [
    { artist: 'Michael Jackson', title: 'Billie Jean' },
    { artist: 'Madonna', title: 'Like a Prayer' },
    { artist: 'Taylor Swift', title: 'Shake It Off' },
  ],
  'hip hop': [
    { artist: 'Kendrick Lamar', title: 'HUMBLE.' },
    { artist: 'Wu-Tang Clan', title: 'C.R.E.A.M.' },
    { artist: 'Lauryn Hill', title: 'Doo Wop (That Thing)' },
  ],
  punk: [
    { artist: 'The Clash', title: 'London Calling' },
    { artist: 'Ramones', title: 'Blitzkrieg Bop' },
    { artist: 'Sex Pistols', title: 'Anarchy in the U.K.' },
  ],
  country: [
    { artist: 'Johnny Cash', title: 'Ring of Fire' },
    { artist: 'Dolly Parton', title: 'Jolene' },
    { artist: 'Willie Nelson', title: 'On the Road Again' },
  ],
}

export const LANGUAGE_POOLS = {
  法语: [
    { artist: 'Édith Piaf', title: 'La Vie en rose' },
    { artist: 'Françoise Hardy', title: 'Tous les garçons et les filles' },
    { artist: 'Stromae', title: 'Alors on danse' },
  ],
  日语: [
    { artist: '宇多田ヒカル', title: 'First Love' },
    { artist: '坂本九', title: '上を向いて歩こう' },
    { artist: 'YOASOBI', title: '夜に駆ける' },
    { artist: '中島美雪', title: '糸' },
  ],
  韩语: [
    { artist: 'BTS', title: 'Dynamite' },
    { artist: 'IU', title: '밤편지' },
    { artist: 'BIGBANG', title: 'Haru Haru' },
  ],
  西班牙语: [
    { artist: 'Luis Fonsi', title: 'Despacito' },
    { artist: 'Shakira', title: "Hips Don't Lie" },
    { artist: 'Rosalía', title: 'MALAMENTE' },
  ],
  葡萄牙语: [
    { artist: 'Antônio Carlos Jobim', title: 'Águas de Março' },
    { artist: 'João Gilberto', title: 'Garota de Ipanema' },
    { artist: 'Marisa Monte', title: 'Ainda Bem' },
  ],
  意大利语: [
    { artist: 'Andrea Bocelli', title: 'Con te partirò' },
    { artist: 'Luciano Pavarotti', title: "'O sole mio" },
  ],
  // v7 批2：补充首启偏好最常选的三种语言（追加在末尾，既有轴顺序不变；池内每首均已 MB 核实）。
  中文: [
    { artist: '周杰倫', title: '稻香' },
    { artist: '陳奕迅', title: '十年' },
    { artist: '五月天', title: '突然好想你' },
    { artist: '李宗盛', title: '山丘' },
  ],
  英语: [
    { artist: 'The Beatles', title: 'Let It Be' },
    { artist: 'Queen', title: 'Bohemian Rhapsody' },
    { artist: 'Adele', title: 'Someone Like You' },
    { artist: 'Coldplay', title: 'Yellow' },
  ],
  粤语: [
    { artist: 'Beyond', title: '海闊天空' },
    { artist: '陳奕迅', title: '富士山下' },
    { artist: '張國榮', title: '風繼續吹' },
    { artist: '陳慧嫻', title: '千千闕歌' },
  ],
}

export const ERA_POOLS = {
  '60s': [
    { artist: 'The Beach Boys', title: 'Good Vibrations' },
    { artist: 'The Beatles', title: 'Hey Jude' },
    { artist: 'The Rolling Stones', title: "(I Can't Get No) Satisfaction" },
  ],
  '70s': [
    { artist: 'Queen', title: 'Bohemian Rhapsody' },
    { artist: 'Eagles', title: 'Hotel California' },
    { artist: '鄧麗君', title: '月亮代表我的心' },
    { artist: 'Bee Gees', title: "Stayin' Alive" },
  ],
  '80s': [
    { artist: 'a-ha', title: 'Take On Me' },
    { artist: 'Michael Jackson', title: 'Billie Jean' },
    { artist: '張國榮', title: 'Monica' },
  ],
  '2000s': [
    { artist: 'Coldplay', title: 'Yellow' },
    { artist: 'Linkin Park', title: 'In the End' },
    { artist: '周杰倫', title: '七里香' },
  ],
  '2010s': [
    { artist: 'Adele', title: 'Rolling in the Deep' },
    { artist: 'Gotye', title: 'Somebody That I Used to Know' },
    { artist: '朴樹', title: '平凡之路' },
  ],
}

export const SCENE_POOLS = {
  深夜: [
    { artist: 'Norah Jones', title: "Don't Know Why" },
    { artist: 'Chet Baker', title: 'My Funny Valentine' },
    { artist: '陳綺貞', title: '旅行的意義' },
  ],
  通勤: [
    { artist: 'Vampire Weekend', title: 'A-Punk' },
    { artist: 'Phoenix', title: '1901' },
    { artist: '五月天', title: '離開地球表面' },
  ],
  运动: [
    { artist: 'Eminem', title: 'Lose Yourself' },
    { artist: 'Survivor', title: 'Eye of the Tiger' },
    { artist: 'Queen', title: "Don't Stop Me Now" },
  ],
  雨天: [
    { artist: '孫燕姿', title: '雨天' },
    { artist: 'Radiohead', title: 'No Surprises' },
    { artist: 'Bon Iver', title: 'Holocene' },
  ],
}

export const WILDCARD_POOL = [
  { artist: 'Khruangbin', title: 'Time (You and I)' },
  { artist: '草東沒有派對', title: '大風吹' },
  { artist: 'Vulfpeck', title: 'Back Pocket' },
  { artist: '告五人', title: '愛人錯過' },
  { artist: 'Alt-J', title: 'Breezeblocks' },
  { artist: 'Tom Misch', title: 'It Runs Through Me' },
]
