import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
	IDataObject
} from 'n8n-workflow';
import * as oracledb from 'oracledb';

class OracleHelper {
	private readonly context: IExecuteFunctions;

	constructor(context: IExecuteFunctions) {
		this.context = context;
	}

	async initializeOraclePool() {
		const credentials = await this.context.getCredentials('oracleApi') as {
			user: string;
			password: string;
			connectionType: string;
			connectionStringEnv: string;
			host: string;
			port: number;
			serviceName: string;
			clientMode: string;
		};

		if (credentials.clientMode !== 'thin') {
			try {
				oracledb.initOracleClient({
					libDir: process.env.ORACLE_CLIENT_LIB_PATH,
					configDir: process.env.ORACLE_CLIENT_CONFIG_DIR,
				});
			} catch (error) {
				if (!(error as Error).message.includes('already initialized')) {
					throw error;
				}
			}
		}

		const poolConfig = {
			user: credentials.user,
			password: credentials.password,
			connectString: this.getConnectString(credentials),
			poolMin: this.context.getNodeParameter('poolOptions.poolMin', 0, 1) as number,
			poolMax: this.context.getNodeParameter('poolOptions.poolMax', 0, 10) as number,
			queueTimeout: this.context.getNodeParameter('poolOptions.queueTimeout', 0, 30000) as number,
		};

		try {
			await oracledb.createPool(poolConfig);
		} catch (error) {
			throw new NodeOperationError(this.context.getNode(), `Error creating Oracle pool: ${(error as Error).message}`);
		}
	}

	getConnectString(credentials: any): string {
		if (credentials.connectionType === 'connectionString') {
			const envVar = credentials.connectionStringEnv;
			if (!process.env[envVar]) {
				throw new NodeOperationError(
					this.context.getNode(),
					`Environment variable ${envVar} is not set`
				);
			}
			return process.env[envVar];
		}
		return `${credentials.host}:${credentials.port}/${credentials.serviceName}`;
	}

	async executeQuery(items: INodeExecutionData[]): Promise<INodeExecutionData[]> {
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			let query = this.context.getNodeParameter('query', i) as string;
			query = this.replaceNullVariables(query, items[i].json);

			const paramsString = this.context.getNodeParameter('parameters', i, '{}') as string;
			const params = this.parseParameters(paramsString);

			const { query: processedQuery, params: processedParams } = this.processQueryAndParams(query, params);

			const format = this.context.getNodeParameter('format', i, 'none') as string;
			const includeOtherInputFields = this.context.getNodeParameter('includeOtherInputFields', i, true) as boolean;

			this.validateQuery(processedQuery, 'query');

			let connection;
			try {
				connection = await oracledb.getConnection();
				const result = await connection.execute(processedQuery, processedParams, { outFormat: oracledb.OUT_FORMAT_OBJECT });
				const rows = result.rows || [];
				const formattedResults = this.formatResults(rows as any[], format);

				if (includeOtherInputFields) {
					for (let j = 0; j < formattedResults.length; j++) {
						returnData.push({
							json: {
								...items[i].json,
								...formattedResults[j].json,
							},
						});
					}
				} else {
					returnData.push(...formattedResults);
				}
			} catch (error) {
				throw new NodeOperationError(
					this.context.getNode(),
					`Error executing query: ${(error as Error).message}`
				);
			} finally {
				if (connection) {
					try {
						await connection.close();
					} catch (error) {
						console.error('Error closing connection:', error);
					}
				}
			}
		}

		return returnData;
	}

	async executeStatement(items: INodeExecutionData[]): Promise<INodeExecutionData[]> {
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			let query = this.context.getNodeParameter('query', i) as string;
			query = this.replaceNullVariables(query, items[i].json);

			const paramsString = this.context.getNodeParameter('parameters', i, '{}') as string;
			const paramsConfig = this.parseParameters(paramsString);

			const { query: processedQuery, params: processedParams } = this.processQueryAndParams(query, paramsConfig);

			const autoCommit = this.context.getNodeParameter('autoCommit', i, true) as boolean;
			const includeOtherInputFields = this.context.getNodeParameter('includeOtherInputFields', i, true) as boolean;

			this.validateQuery(processedQuery, 'execute');

			let connection;
			try {
				connection = await oracledb.getConnection();

				let params = processedParams;
				const options = { autoCommit };
				let returningIntoKey: string | undefined;

				if (processedParams.hasOwnProperty('__outBinds__')) {
					returningIntoKey = Object.keys(processedParams.__outBinds__)[0];
					const outBindConfig = processedParams.__outBinds__[returningIntoKey];

					const bindType = (oracledb as any)[outBindConfig.type];
					if (!bindType) {
						throw new NodeOperationError(this.context.getNode(), `Invalid oracledb type: ${outBindConfig.type}`);
					}

					params = {
						...params,
						[returningIntoKey]: {
							type: bindType,
							dir: oracledb.BIND_OUT,
						},
					};

					delete params.__outBinds__;
				}

				const result = await connection.execute(processedQuery, params, options);

				const jsonData: IDataObject = {};

				if (result.rowsAffected) {
					jsonData.affectedRows = result.rowsAffected;
				}

				const resultOutBinds = result.outBinds as Record<string, any>;
				if (returningIntoKey && resultOutBinds && resultOutBinds[returningIntoKey]) {
					jsonData[returningIntoKey] = resultOutBinds[returningIntoKey];
				}

				if (includeOtherInputFields) {
					returnData.push({
						json: {
							...items[i].json,
							...jsonData,
						},
					});
				} else {
					returnData.push(...this.context.helpers.returnJsonArray([jsonData]));
				}
			} catch (error) {
				throw new NodeOperationError(
					this.context.getNode(),
					`Error executing statement: ${(error as Error).message}`
				);
			} finally {
				if (connection) {
					try {
						await connection.close();
					} catch (error) {
						console.error('Error closing connection:', error);
					}
				}
			}
		}

		return returnData;
	}

	private processQueryAndParams(query: string, params: any): { query: string; params: any } {
		let processedQuery = query;
		const processedParams: any = {};

		for (const [key, value] of Object.entries(params)) {
			if (value === null || value === undefined) {
				const regex = new RegExp(`:${key}\\b`, 'g');
				processedQuery = processedQuery.replace(regex, 'NULL');
			} else {
				processedParams[key] = value;
			}
		}

		return { query: processedQuery, params: processedParams };
	}

	replaceNullVariables(query: string, itemJson: IDataObject): string {
		return query.replace(/\{\{\s*\$json\.([a-zA-Z0-9_]+)(?:\s*\?\?\s*null)?\s*\}\}/g, (_, key) => {
			const value = itemJson[key];
			if (value === null || value === undefined) {
				return 'NULL';
			}
			if (typeof value === 'string') {
				return `'${value.replace(/'/g, "''")}'`;
			}
			return String(value);
		});
	}

	private fixInvalidJson(jsonString: string): string {
		return jsonString.replace(/:\s*}/g, ': null}')
			.replace(/:\s*,/g, ': null,');
	}

	private parseParameters(paramsString: string): any {
		try {
			return JSON.parse(paramsString);
		} catch (error) {
			const fixedJson = this.fixInvalidJson(paramsString);

			try {
				return JSON.parse(fixedJson);
			} catch (secondError) {
				throw new NodeOperationError(
					this.context.getNode(),
					`Invalid JSON parameters: ${paramsString}. Error: ${(error as Error).message}`
				);
			}
		}
	}

	validateQuery(query: string, operation: string): void {
		const upperQuery = query.toUpperCase();

		if (operation === 'query') {
			const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER'];
			const hasForbiddenKeyword = forbidden.some(keyword => {
				const regex = new RegExp(`\\b${keyword}\\b`);
				return regex.test(upperQuery);
			});

			if (hasForbiddenKeyword) {
				throw new NodeOperationError(
					this.context.getNode(),
					'Invalid query type for SELECT operation. Use Execute Statement for non-SELECT queries.'
				);
			}
		}
	}

	formatResults(rows: any[], format: string): INodeExecutionData[] {
		if (!rows || rows.length === 0) {
			return this.context.helpers.returnJsonArray([{}]);
		}

		if (format === 'uppercase') {
			const upperRows = rows.map(row => {
				const newRow: Record<string, any> = {};
				for (const key in row) {
					newRow[key.toUpperCase()] = row[key];
				}
				return newRow;
			});
			return this.context.helpers.returnJsonArray(upperRows);
		}

		if (format === 'lowercase') {
			const lowerRows = rows.map(row => {
				const newRow: Record<string, any> = {};
				for (const key in row) {
					newRow[key.toLowerCase()] = row[key];
				}
				return newRow;
			});
			return this.context.helpers.returnJsonArray(lowerRows);
		}

		return this.context.helpers.returnJsonArray(rows);
	}

	async closeOraclePool(): Promise<void> {
		try {
			const pool = oracledb.getPool();
			if (pool) {
				await pool.close();
			}
		} catch (error) {
			console.error('Error closing connection pool:', error);
		}
	}
}

export class Oracle implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Oracle Database',
		documentationUrl: 'https://rempel.github.io/n8n-oracle-connector/#/',
		name: 'oracle',
		icon: 'file:oracle.svg',
		group: ['transform'],
		version: 1,
		description: 'Interact with Oracle Database',
		defaults: {
			name: 'Oracle Database',
		},
		inputs: ['main'] as any,
		outputs: ['main'] as any,
		credentials: [
			{
				name: 'oracleApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Database',
						value: 'database',
					},
				],
				default: 'database',
				required: true,
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Execute Query',
						value: 'query',
						description: 'Execute SELECT query',
						action: 'Execute SELECT query',
					},
					{
						name: 'Execute Statement',
						value: 'execute',
						description: 'Execute DML/DDL statements or procedures',
						action: 'Execute DML/DDL statements or procedures',
					},
				],
				default: 'query',
				required: true,
			},
			{
				displayName: 'SQL Query',
				name: 'query',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['query', 'execute'],
					},
				},
				default: '',
				placeholder: 'SELECT * FROM users WHERE id = :id',
				required: true,
			},
			{
				displayName: 'Parameters',
				name: 'parameters',
				type: 'json',
				displayOptions: {
					show: {
						operation: ['query', 'execute'],
					},
				},
				default: '{}',
				description: 'Bind parameters in JSON format',
			},
			{
				displayName: 'Auto Commit',
				name: 'autoCommit',
				type: 'boolean',
				displayOptions: {
					show: {
						operation: ['execute'],
					},
				},
				default: true,
				description: 'Whether to automatically commit transactions',
			},
			{
				displayName: 'Include Other Input Fields',
				name: 'includeOtherInputFields',
				type: 'boolean',
				displayOptions: {
					show: {
						operation: ['query', 'execute'],
					},
				},
				default: false,
				description: 'Whether to pass to the output all the input fields',
			},
			{
				displayName: 'Result Format',
				name: 'format',
				type: 'options',
				options: [
					{ name: 'Uppercase', value: 'uppercase' },
					{ name: 'Lowercase', value: 'lowercase' },
					{ name: 'Original', value: 'none' },
				],
				displayOptions: {
					show: {
						operation: ['query'],
					},
				},
				default: 'none',
				required: true,
			},
			{
				displayName: 'Connection Pool Options',
				name: 'poolOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Pool Min',
						name: 'poolMin',
						type: 'number',
						default: 1,
					},
					{
						displayName: 'Pool Max',
						name: 'poolMax',
						type: 'number',
						default: 10,
					},
					{
						displayName: 'Queue Timeout (Ms)',
						name: 'queueTimeout',
						type: 'number',
						default: 30000,
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		let returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		const helper = new OracleHelper(this);

		try {
			await helper.initializeOraclePool();

			if (resource === 'database') {
				switch (operation) {
					case 'query':
						returnData = await helper.executeQuery(items);
						break;
					case 'execute':
						returnData = await helper.executeStatement(items);
						break;
					default:
						throw new NodeOperationError(this.getNode(), `Unsupported operation: ${operation}`);
				}
			}

			return [returnData];
		} catch (error) {
			throw new NodeOperationError(this.getNode(), error as Error);
		} finally {
			await helper.closeOraclePool();
		}
	}
}
