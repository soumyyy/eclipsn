import { buildSchema } from 'graphql';

export const schema = buildSchema(`
  type User {
    id: ID!
    email: String!
  }

  type Task {
    id: ID!
    description: String!
    status: String!
  }

  type Query {
    me: User
    tasks: [Task!]!
  }
`);
