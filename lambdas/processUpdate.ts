import { SNSHandler } from "aws-lambda";
  import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
  import { DynamoDBDocumentClient, UpdateCommand, 
    QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

const ddbDocClient = createDDbDocClient();

export const handler: SNSHandler = async (event: any) => {
    console.log("Event ", JSON.stringify(event));

    const message = JSON.parse(event.Records[0].Sns.Message);
    if(!message) {
        console.log("No message found");
        return;
    }
    console.log("Message ", message);
    const imageName = message.name;
    const imageDescription = message.description;

    //Check if the image exists
    const getCommand = new GetCommand({
        TableName: "Images",
        Key: {
            ImageName: imageName,
        },
    });
    const output = await ddbDocClient.send(getCommand);
    console.log("Image Get Output ", output);
    if (!output.Item) {
        console.log("Image not found");
        return;
    }

    //Update the table with the new info
    const updateCommand = new UpdateCommand({
        TableName: "Images",
        Key: {
            ImageName: imageName,
        },
        UpdateExpression: "set ImageDescription = :d",
        ExpressionAttributeValues: {
            ":d": imageDescription,
        },
    });

    const updateOutput = await ddbDocClient.send(updateCommand);
    console.log("Update output ", updateOutput);
  
};

function createDDbDocClient() {
    const ddbClient = new DynamoDBClient({ region: process.env.REGION });
    const marshallOptions = {
      convertEmptyValues: true,
      removeUndefinedValues: true,
      convertClassInstanceToMap: true,
    };
    const unmarshallOptions = {
      wrapNumbers: false,
    };
    const translateConfig = { marshallOptions, unmarshallOptions };
    return DynamoDBDocumentClient.from(ddbClient, translateConfig);
  }