import type { RebarDbSection } from '../../api/settingsHub'

export type ColumnDef = { key: string; label: string }

export const REBAR_DB_COLUMNS: Record<RebarDbSection, ColumnDef[]> = {
  /** 데스크톱 벽체 일람표와 동일 필드 (부호·층·두께·수직근·수평근·전단보강근·비고) */
  schedule_wall: [
    { key: 'mark', label: '부호' },
    { key: 'floor', label: '층' },
    { key: 'thickness', label: '두께' },
    { key: 'vertical_rebar', label: '수직근' },
    { key: 'horizontal_rebar', label: '수평근' },
    { key: 'shear_rebar', label: '전단보강근' },
    { key: 'remarks', label: '비고' },
  ],
  schedule_lintel: [
    { key: 'mark', label: '부호' },
    { key: 'floor', label: '층' },
    { key: 'thickness', label: '두께' },
    { key: 'height', label: '높이' },
    { key: 'top_rebar', label: '상부근' },
    { key: 'bottom_rebar', label: '하부근' },
    { key: 'surface_rebar', label: '표면철근' },
    { key: 'stirrup', label: 'STIRRUP' },
    { key: 'remarks', label: '비고' },
  ],
  /** 기둥 일람표 (데스크톱 UI와 동일 순서) */
  schedule_column: [
    { key: 'mark', label: '부호' },
    { key: 'floor', label: '층' },
    { key: 'section', label: '단면' },
    { key: 'main_bar', label: '주근' },
    { key: 'hoop', label: '후프' },
    { key: 'sup_hoop', label: '보조후프' },
    { key: 'spacing_end_center', label: '간격(단부, 중앙부)' },
    { key: 'sup_hoop_h_pos', label: '가로 보조후프 위치' },
    { key: 'sup_hoop_v_pos', label: '세로 보조후프 위치' },
    { key: 'remarks', label: '비고' },
  ],
  length_stock: [
    { key: 'diameter_mm', label: '직경' },
    { key: 'long_bar_length', label: '장대길이' },
    { key: 'remarks', label: '비고' },
  ],
  length_lap: [
    { key: 'fck', label: 'Fck' },
    { key: 'fy', label: 'Fy' },
    { key: 'diameter_mm', label: '직경' },
    { key: 'top_anchor', label: '상부정착' },
    { key: 'general_anchor', label: '일반정착' },
    { key: 'compression_anchor', label: '압축정착' },
    { key: 'hook_anchor', label: '후크정착' },
    { key: 'top_lap', label: '상부이음' },
    { key: 'general_lap', label: '일반이음' },
    { key: 'compression_lap', label: '압축이음' },
    { key: 'u_bar_length', label: 'UBar 길이' },
    { key: 'remarks', label: '비고' },
  ],
  common_wall: [
    { key: 'div1', label: '구분1' },
    { key: 'div2', label: '구분2' },
    { key: 'material', label: '재질' },
    { key: 'size1', label: '크기' },
    { key: 'size2', label: '크기2' },
    { key: 'usage', label: '용도' },
    { key: 'prefix', label: '접두어' },
    { key: 'num', label: '번호' },
    { key: 'name', label: '이름' },
    { key: 'class_name', label: '클래스' },
  ],
  common_lintel: [
    { key: 'div1', label: '구분1' },
    { key: 'div2', label: '구분2' },
    { key: 'material', label: '재질' },
    { key: 'size1', label: '크기' },
    { key: 'size2', label: '크기2' },
    { key: 'usage', label: '용도' },
    { key: 'prefix', label: '접두어' },
    { key: 'num', label: '번호' },
    { key: 'name', label: '이름' },
    { key: 'class_name', label: '클래스' },
  ],
  common_column: [
    { key: 'div1', label: '구분1' },
    { key: 'div2', label: '구분2' },
    { key: 'material', label: '재질' },
    { key: 'size1', label: '크기' },
    { key: 'size2', label: '크기2' },
    { key: 'usage', label: '용도' },
    { key: 'prefix', label: '접두어' },
    { key: 'num', label: '번호' },
    { key: 'name', label: '이름' },
    { key: 'class_name', label: '클래스' },
  ],
}

/** 세로 폼 모달 제목 (추가 시) */
export const REBAR_DB_MODAL_TITLES: Record<RebarDbSection, string> = {
  schedule_wall: '벽체 일람표',
  schedule_lintel: '인방보 일람표',
  schedule_column: '기둥 일람표',
  length_stock: '장대길이',
  length_lap: '이음/정착 길이',
  common_wall: '벽체 공통속성',
  common_lintel: '인방보 공통속성',
  common_column: '기둥 공통속성',
}

export const LAP_PICKER_FCK_OPTIONS = [
  'C21',
  'C24',
  'C27',
  'C30',
  'C35',
  'C40',
  'C45',
  'C50',
  'C55',
  'C60',
  'C65',
  'C70',
  'C75',
  'C80',
  'C85',
  'C90',
  'C95',
] as const

export const LAP_PICKER_FY_OPTIONS = ['SD300', 'SD400', 'SD500', 'SD600', 'SD600S', 'SD700'] as const

export const LAP_PICKER_DIAMETER_OPTIONS = [
  '10',
  '13',
  '16',
  '19',
  '22',
  '25',
  '29',
  '32',
  '35',
  '38',
  '41',
  '51',
  '57',
] as const

/** 직경 선택 후 자동 생성 행에 0을 넣을 필드 (데스크톱 기본값과 동일) */
export const LENGTH_LAP_ZERO_DEFAULT_KEYS = [
  'top_anchor',
  'general_anchor',
  'compression_anchor',
  'hook_anchor',
  'top_lap',
  'general_lap',
  'compression_lap',
] as const
