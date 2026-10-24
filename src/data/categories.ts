import type { Category } from './catalog.types';

export const categories: readonly Category[] = [
  {
    id: 'repair',
    title: 'Ремонт и отделка',
    description: 'Обои, напольные покрытия, краска, плитка и отделочные смеси.',
    order: 1,
  },
  {
    id: 'construction',
    title: 'Строительство',
    description: 'Фундамент, стены, кровля и основные строительные материалы.',
    order: 2,
  },
  {
    id: 'area-volume',
    title: 'Площади и объёмы',
    description: 'Площадь помещений и стен, объём бетона, грунта и сыпучих материалов.',
    order: 3,
  },
  {
    id: 'cost',
    title: 'Стоимость работ',
    description: 'Ориентировочная стоимость материалов и ремонтных работ.',
    order: 4,
  },
];
