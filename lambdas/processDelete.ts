import { SNSHandler } from "aws-lambda";
import {
    GetObjectCommand,
    PutObjectCommandInput,
    GetObjectCommandInput,
    S3Client,
    PutObjectCommand,
  } from "@aws-sdk/client-s3";
  import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
  import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const ddbDocClient = createDDbDocClient();

export const handler: SNSHandler = async (event: any) => {
    console.log("Event ", JSON.stringify(event));
    for (const snsRecord of event.Records) {
        const snsMessage = snsRecord.Sns.Message;
        const messageData = JSON.parse(snsMessage);
        const s3e = messageData.Records[0].s3;
        const srcBucket = s3e.bucket.name;
        const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));
        const eventName = messageData.Records[0].eventName;
        if (eventName !== "ObjectRemoved:Delete") {
            return; // Filter out any events that are not delete events
        }
        
        console.log("s3e ", s3e);
        
        const deleteCommand = new DeleteCommand({
            TableName: "Images",
            Key: {
                ImageName: srcKey,
            },
        });

        const output = await ddbDocClient.send(deleteCommand);

        console.log("Output ", output);
    }
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