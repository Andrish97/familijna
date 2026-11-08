// Tłumaczenia UK — część „snake”.
const uk = {
  snake: {
    title: "Familijna — змійка",
    boardLabel: "Табло з грою в змійку",
    keysHint: "Стрілки або WASD, пробіл або клік по табло — пауза.",
    progressAccount: ({ best, games }) => `Рекорд в акаунті: ${best} · ігор: ${games}`,
    progressLocal: "Увійди, щоб зберегти рекорд",
    login: "Увійти",
    signedInAs: ({ name }) => `Увійдено як ${name}`,
    home: "Familijna",
    rotateMessage: "Поверни телефон горизонтально — змійка повзає по всьому Дисплею.",
    board: {
      title: "ЗМІЙКА FAMILIJNA",
      press: "НАТИСНИ СТРІЛКУ",
      swipe: "ПРОВЕДИ ПАЛЬЦЕМ",
      click: "КЛІК = ПАУЗА",
      tap: "ТОРКНИСЬ = ПАУЗА",
      over: "КІНЕЦЬ ГРИ",
      won: "ВСЕ ТАБЛО!",
      score: ({ score }) => `РАХУНОК: ${score}`,
      record: "НОВИЙ РЕКОРД!",
      again: "СТРІЛКА = ЩЕ РАЗ",
      againTouch: "ПРОВЕДИ = ЩЕ РАЗ",
    },
    long: { score: "РАХУНОК", best: "РЕКОРД", paused: "ПАУЗА", bonus: ({ points }) => `БОНУС +${points}` },
  },
};

export default uk;
