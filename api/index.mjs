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
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  AdminGetUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminDeleteUserCommand,
  AdminUserGlobalSignOutCommand,
  AdminResetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { createApp } from './src/app.js';
import { createStore } from './src/store.js';
import { createMembers } from './src/members.js';

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

const COGNITO = {
  ListUsers: ListUsersCommand,
  ListUsersInGroup: ListUsersInGroupCommand,
  AdminGetUser: AdminGetUserCommand,
  AdminDisableUser: AdminDisableUserCommand,
  AdminEnableUser: AdminEnableUserCommand,
  AdminDeleteUser: AdminDeleteUserCommand,
  AdminUserGlobalSignOut: AdminUserGlobalSignOutCommand,
  AdminResetUserPassword: AdminResetUserPasswordCommand,
  AdminAddUserToGroup: AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroup: AdminRemoveUserFromGroupCommand,
};
const cognito = new CognitoIdentityProviderClient({});
const cognitoSend = (op, params) => cognito.send(new COGNITO[op](params));

const app = createApp({
  store: createStore({ send, table: process.env.TABLE_NAME }),
  members: createMembers({ send: cognitoSend, userPoolId: process.env.USER_POOL_ID }),
  ownerSub: process.env.OWNER_SUB || '',
});

export const handler = (event) => app(event);
