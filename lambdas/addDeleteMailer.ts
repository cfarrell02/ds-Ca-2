
import type { DynamoDBStreamHandler } from "aws-lambda";
import { SESClient, SendEmailCommand, SendEmailCommandInput } from "@aws-sdk/client-ses";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";

if (!SES_EMAIL_TO || !SES_EMAIL_FROM || !SES_REGION) {
    throw new Error(
      "Please add the SES_EMAIL_TO, SES_EMAIL_FROM, and SES_REGION environment variables in an env.js file located in the root directory"
    );
  }
  
  const client = new SESClient({ region: SES_REGION });

export const handler:DynamoDBStreamHandler =  async (event) => {
    console.log("Event ", JSON.stringify(event));

    for (const record of event.Records) {
        const dynamoDBRecord = record.dynamodb;
        if (!dynamoDBRecord) {
            console.log("No dynamoDBRecord found");
            return;
        }
        const keys = dynamoDBRecord.Keys;
        if (!keys) {
            console.log("No keys found");
            return;
        }
        const eventTime = dynamoDBRecord.ApproximateCreationDateTime;
        let eventTimeStr = eventTime?.toString();
        if (eventTime) {
        eventTimeStr = new Date(eventTime*1000).toLocaleString();
        }
        const imageName = keys.ImageName.S;
        let message = "Error";
        let subject = "Error";
        if(record.eventName === "INSERT") {
            message = `The image "${imageName}" was added at ${eventTimeStr}`;
            subject = "Image Added";
        }else if(record.eventName === "REMOVE") {
            message = `The image "${imageName}" was deleted at ${eventTimeStr}`;
            subject = "Image Deleted";
        }
        await sendConfirmationEmail(message, subject);
    }
}

async function sendConfirmationEmail(message: string, subject: string) {
    const parameters: SendEmailCommandInput = {
      Destination: {
        ToAddresses: [SES_EMAIL_TO],
      },
      Message: {
        Body: {
          Html: {
            Charset: "UTF-8",
            Data: getHtmlContent(message),
          },
        },
        Subject: {
          Charset: "UTF-8",
          Data: `${subject}`,
        },
      },
      Source: SES_EMAIL_FROM,
    };
    await client.send(new SendEmailCommand(parameters));
  }
  
  function getHtmlContent(message: string) {
    return `
      <html>
        <body>
          <p style="font-size:18px">${message}</p>
        </body>
      </html> 
    `;
  }
  