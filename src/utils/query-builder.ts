import { and, asc, count, desc, eq, getTableColumns, gt, gte, inArray, lt, lte, type SQL, sql } from 'drizzle-orm';
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Db } from '@/db';

type QueryParams = Record<string, string | string[] | undefined>;
type TableColumns<TTable extends SQLiteTable> = TTable['_']['columns'];
type FieldName<TTable extends SQLiteTable> = Extract<keyof TableColumns<TTable>, string>;
type SelectShape<TTable extends SQLiteTable, TField extends FieldName<TTable>> = Pick<TableColumns<TTable>, TField>;

type QueryOperator = 'eq' | 'like' | 'in' | 'gt' | 'lt' | 'gteq' | 'lteq';

export interface HandleListQueryConfig<TTable extends SQLiteTable, TField extends FieldName<TTable>> {
	db: Db;
	allowedFields: readonly TField[];
	defaultSortField?: TField;
	forcedConditions?: SQL[];
}

export interface ListQueryResult<TItem> {
	page: number;
	pageSize: number;
	total: number;
	list: TItem[];
}

/**
 * 通用列表查询构建器。
 *
 * 约定：
 * - page 从 0 开始。
 * - pagesize 默认 10。
 * - 默认按 defaultSortField 降序。
 * - sort=id 表示升序，sort=-id 表示降序。
 * - 仅 allowedFields 白名单字段允许被查询、排序和返回。
 * - like 查询会把 %、_、\ 作为普通字符处理。
 */
export async function handleListQuery<TTable extends SQLiteTable, TField extends FieldName<TTable>>(
	table: TTable,
	queryParams: QueryParams,
	config: HandleListQueryConfig<TTable, TField>,
): Promise<ListQueryResult<SelectResult<SelectShape<TTable, TField>>>> {
	const page = parsePage(queryParams.page);
	const pageSize = parsePageSize(queryParams.pagesize);
	const offset = page * pageSize;
	const columns = getTableColumns(table) as TableColumns<TTable>;
	const allowedFieldSet = new Set<string>(config.allowedFields);
	const selectFields = buildSelectFields(columns, config.allowedFields);
	const whereClause = buildWhereClause(columns, queryParams, allowedFieldSet, config.forcedConditions ?? []);
	const sortField = resolveSortField(queryParams.sort, config.defaultSortField ?? ('id' as TField), allowedFieldSet);
	const sortColumn = columns[sortField] as AnySQLiteColumn;
	const orderBy = parseSortDirection(queryParams.sort) === 'asc' ? asc(sortColumn) : desc(sortColumn);
	const countRows = await config.db.select({ total: count() }).from(table).where(whereClause);
	const total = countRows[0]?.total ?? 0;
	const list = await config.db.select(selectFields).from(table).where(whereClause).orderBy(orderBy).limit(pageSize).offset(offset);

	return {
		page,
		pageSize,
		total,
		list: list as SelectResult<SelectShape<TTable, TField>>[],
	};
}

type SelectResult<TSelection> = {
	[TKey in keyof TSelection]: TSelection[TKey] extends { _: { data: infer TData } } ? TData : unknown;
};

function buildSelectFields<TTable extends SQLiteTable, TField extends FieldName<TTable>>(
	columns: TableColumns<TTable>,
	allowedFields: readonly TField[],
): SelectShape<TTable, TField> {
	return allowedFields.reduce<Partial<SelectShape<TTable, TField>>>((selection, field) => {
		selection[field] = columns[field];
		return selection;
	}, {}) as SelectShape<TTable, TField>;
}

function buildWhereClause<TTable extends SQLiteTable>(
	columns: TableColumns<TTable>,
	queryParams: QueryParams,
	allowedFieldSet: Set<string>,
	forcedConditions: SQL[],
): SQL | undefined {
	const conditions: SQL[] = [...forcedConditions];

	for (const [rawKey, rawValue] of Object.entries(queryParams)) {
		if (isReservedParam(rawKey) || rawValue === undefined) {
			continue;
		}

		const parsedFilter = parseFilterKey(rawKey);

		if (!parsedFilter || !allowedFieldSet.has(parsedFilter.field)) {
			continue;
		}

		const column = columns[parsedFilter.field as keyof TableColumns<TTable>] as AnySQLiteColumn | undefined;

		if (!column) {
			continue;
		}

		const condition = buildCondition(column, parsedFilter.operator, getFirstQueryValue(rawValue));

		if (condition) {
			conditions.push(condition);
		}
	}

	return conditions.length > 0 ? and(...conditions) : undefined;
}

function buildCondition(column: AnySQLiteColumn, operator: QueryOperator, rawValue: string): SQL | undefined {
	if (rawValue.trim().length === 0) {
		return undefined;
	}

	if (operator === 'like') {
		return sql`${column} LIKE ${`%${escapeLikeValue(rawValue.trim())}%`} ESCAPE '\\'`;
	}

	if (operator === 'in') {
		const values = rawValue
			.split(',')
			.map((value) => parseQueryValue(value))
			.filter((value) => value !== null);

		return values.length > 0 ? inArray(column, values) : undefined;
	}

	const value = parseQueryValue(rawValue);

	if (value === null) {
		return undefined;
	}

	switch (operator) {
		case 'eq':
			return eq(column, value);
		case 'gt':
			return gt(column, value);
		case 'lt':
			return lt(column, value);
		case 'gteq':
			return gte(column, value);
		case 'lteq':
			return lte(column, value);
		default:
			return undefined;
	}
}

function parseFilterKey(key: string): { field: string; operator: QueryOperator } | null {
	const segments = key.split('-');

	if (segments.length === 1) {
		return {
			field: key,
			operator: 'eq',
		};
	}

	const operator = segments.at(-1);

	if (!isQueryOperator(operator)) {
		return null;
	}

	return {
		field: segments.slice(0, -1).join('-'),
		operator,
	};
}

function isQueryOperator(value: string | undefined): value is QueryOperator {
	return value === 'eq' || value === 'like' || value === 'in' || value === 'gt' || value === 'lt' || value === 'gteq' || value === 'lteq';
}

function resolveSortField<TField extends string>(
	rawSort: string | string[] | undefined,
	defaultSortField: TField,
	allowedFieldSet: Set<string>,
): TField {
	const sort = getFirstQueryValue(rawSort);
	const normalizedField = sort.startsWith('-') ? sort.slice(1) : sort;

	return allowedFieldSet.has(normalizedField) ? (normalizedField as TField) : defaultSortField;
}

function parseSortDirection(rawSort: string | string[] | undefined): 'asc' | 'desc' {
	const sort = getFirstQueryValue(rawSort).trim();

	if (!sort) {
		return 'desc';
	}

	return sort.startsWith('-') ? 'desc' : 'asc';
}

function parsePage(value: string | string[] | undefined): number {
	const parsed = Number.parseInt(getFirstQueryValue(value), 10);

	return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parsePageSize(value: string | string[] | undefined): number {
	const parsed = Number.parseInt(getFirstQueryValue(value), 10);

	if (!Number.isInteger(parsed) || parsed <= 0) {
		return 10;
	}

	return Math.min(parsed, 100);
}

function parseQueryValue(value: string): string | number | null {
	const trimmed = value.trim();

	if (trimmed.length === 0) {
		return null;
	}

	const numericValue = Number(trimmed);

	return Number.isFinite(numericValue) && trimmed !== '' ? numericValue : trimmed;
}

function getFirstQueryValue(value: string | string[] | undefined): string {
	if (Array.isArray(value)) {
		return value[0] ?? '';
	}

	return value ?? '';
}

function isReservedParam(key: string): boolean {
	return key === 'page' || key === 'pagesize' || key === 'sort';
}

function escapeLikeValue(value: string): string {
	return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}
