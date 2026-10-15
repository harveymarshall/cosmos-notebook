// AWS Lambda entry point. Uses the AWS SDK that ships with the Node.js Lambda runtime,
// so there is nothing to install or bundle.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  QueryCommand,
  TransactWriteCommand,
  BatchWriteCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { createApp } from './src/app.js';
import { createStore } from './src/store.js';

const COMMANDS = {
  Get: GetCommand,
  Put: PutCommand,
  Delete: DeleteCommand,
  Update: UpdateCommand,
  Query: QueryCommand,
  TransactWrite: TransactWriteCommand,
  BatchWrite: BatchWriteCommand,
  BatchGet: BatchGetCommand,
};

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const send = (op, params) => doc.send(new COMMANDS[op](params));

const app = createApp({ store: createStore({ send, table: process.env.TABLE_NAME }) });

export const handler = (event) => app(event);
