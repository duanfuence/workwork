import { describe, expect, it } from 'vitest';
import {
  mergeRoom,
  parseStoredRoom,
  roomFill,
  roomNoticeSizes,
  roomToSave,
  serializeRoom,
  type RoomControls,
} from './room-memory';

const room: RoomControls = {
  roomLength: { value: '4', active: true },
  roomWidth: { value: '3', active: true },
  wallHeight: { value: '2,7', active: true },
};
const empty: RoomControls = {
  roomLength: { value: '', active: true },
  roomWidth: { value: '', active: true },
  wallHeight: { value: '', active: true },
};

describe('что сохранить', () => {
  it('три размера помещения — числами', () => {
    expect(roomToSave(room)).toEqual({ roomLength: 4, roomWidth: 3, wallHeight: 2.7 });
  });

  it('ламинат: только длина и ширина', () => {
    expect(
      roomToSave({
        roomLength: { value: '4', active: true },
        roomWidth: { value: '3', active: true },
      }),
    ).toEqual({
      roomLength: 4,
      roomWidth: 3,
    });
  });

  it('режим «отдельные стены» (поля помещения скрыты) — ничего', () => {
    expect(
      roomToSave({
        roomLength: { value: '4', active: false },
        roomWidth: { value: '3', active: false },
        wallHeight: { value: '2,7', active: true },
      }),
    ).toBeNull();
  });

  it('пустая ширина или текст — ничего; неверная высота пропускается', () => {
    expect(roomToSave({ ...room, roomWidth: { value: '', active: true } })).toBeNull();
    expect(roomToSave({ ...room, roomLength: { value: 'abc', active: true } })).toBeNull();
    expect(roomToSave({ ...room, wallHeight: { value: '-1', active: true } })).toEqual({
      roomLength: 4,
      roomWidth: 3,
    });
  });
});

describe('формат хранения', () => {
  it('круговая проверка: запись → разбор', () => {
    const sizes = { roomLength: 4, roomWidth: 3.5, wallHeight: 2.7 };
    expect(serializeRoom(sizes)).toBe('{"v":1,"roomLength":4,"roomWidth":3.5,"wallHeight":2.7}');
    expect(parseStoredRoom(serializeRoom(sizes))).toEqual(sizes);
  });

  it('старая или чужая версия, повреждённая запись, пусто — ничего', () => {
    expect(parseStoredRoom('{"v":0,"roomLength":4}')).toBeNull();
    expect(parseStoredRoom('{"roomLength":4,"roomWidth":3}')).toBeNull();
    expect(parseStoredRoom('{"v":2,"roomLength":4}')).toBeNull();
    expect(parseStoredRoom('{"v":1')).toBeNull();
    expect(parseStoredRoom('null')).toBeNull();
    expect(parseStoredRoom('[1,2]')).toBeNull();
    expect(parseStoredRoom(null)).toBeNull();
  });

  it('неправдоподобные значения отбрасываются, лишние ключи не читаются', () => {
    expect(
      parseStoredRoom(
        '{"v":1,"roomLength":"4","roomWidth":-3,"wallHeight":1e9,"name":"Иван","price":100}',
      ),
    ).toBeNull();
    expect(parseStoredRoom('{"v":1,"roomLength":4,"secret":"x"}')).toEqual({ roomLength: 4 });
  });

  it('высота из прошлого расчёта остаётся, если в новом её нет', () => {
    expect(
      mergeRoom({ roomLength: 5, roomWidth: 4, wallHeight: 2.7 }, { roomLength: 4, roomWidth: 3 }),
    ).toEqual({
      roomLength: 4,
      roomWidth: 3,
      wallHeight: 2.7,
    });
    expect(mergeRoom(null, { roomLength: 4, roomWidth: 3 })).toEqual({
      roomLength: 4,
      roomWidth: 3,
    });
  });
});

describe('что подставить', () => {
  const stored = { roomLength: 4, roomWidth: 3, wallHeight: 2.7 };

  it('в пустые поля — с десятичной запятой', () => {
    expect(roomFill(stored, empty)).toEqual({ roomLength: '4', roomWidth: '3', wallHeight: '2,7' });
  });

  it('заполненные поля не трогаются', () => {
    expect(roomFill(stored, { ...empty, roomLength: { value: '6', active: true } })).toEqual({
      roomWidth: '3',
      wallHeight: '2,7',
    });
    expect(roomFill(stored, room)).toEqual({});
  });

  it('ламинат: высоты нет на странице — только длина и ширина', () => {
    expect(
      roomFill(stored, {
        roomLength: { value: '', active: true },
        roomWidth: { value: '', active: true },
      }),
    ).toEqual({
      roomLength: '4',
      roomWidth: '3',
    });
  });

  it('поле длины помещения скрыто (режим «стены») или нет сохранённого — ничего', () => {
    expect(roomFill(stored, { ...empty, roomLength: { value: '', active: false } })).toEqual({});
    expect(roomFill(null, empty)).toEqual({});
  });

  it('плитка и другие формы без полей помещения — ничего', () => {
    expect(roomFill(stored, {})).toEqual({});
  });

  it('строка над формой: «4 × 3 × 2,7 м»', () => {
    expect(roomNoticeSizes({ roomLength: '4', roomWidth: '3', wallHeight: '2,7' })).toBe(
      '4 × 3 × 2,7 м',
    );
    expect(roomNoticeSizes({ roomWidth: '3' })).toBe('3 м');
    expect(roomNoticeSizes({})).toBe('');
  });
});
