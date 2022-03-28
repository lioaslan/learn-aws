import {
  aws_certificatemanager,
  aws_cloudfront,
  aws_ec2,
  aws_elasticloadbalancingv2,
  aws_elasticloadbalancingv2_targets,
  aws_route53,
  Stack,
  StackProps
} from 'aws-cdk-lib';
import { CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import {
  AllowedMethods,
  CachedMethods,
  OriginRequestPolicy,
  ViewerProtocolPolicy
} from 'aws-cdk-lib/aws-cloudfront';
import { LoadBalancerV2Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Peer, Port } from 'aws-cdk-lib/aws-ec2';
import {
  ListenerAction,
  ListenerCertificate
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';

export class AwsManagedPlStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const STACK_NAME = 'TestAwsManagedPL';

    // =============VPC===============
    const vpc = aws_ec2.Vpc.fromLookup(this, 'Default', {
      vpcId: 'vpc-21d8cd46',
      isDefault: true
    });

    //================SG=================

    const ec2SecurityGroup = new aws_ec2.SecurityGroup(
      this,
      `${STACK_NAME}EC2SG`,
      { vpc }
    );

    const ipCidrVpc = '172.31.0.0/16';
    ec2SecurityGroup.addIngressRule(Peer.ipv4(ipCidrVpc), Port.tcp(80));
    ec2SecurityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(22));

    //==============EC2===================
    const amiName =
      'bitnami-nginx-1.20.2-17-r08-linux-debian-10-x86_64-hvm-ebs-nami-f5774628-e459-457a-b058-3b513caefdee';
    const keyName = 'ultorex-staging-key';

    const instance = new aws_ec2.Instance(this, `${STACK_NAME}`, {
      vpc,
      instanceType: aws_ec2.InstanceType.of(
        aws_ec2.InstanceClass.T3,
        aws_ec2.InstanceSize.SMALL
      ),
      machineImage: aws_ec2.MachineImage.lookup({ name: amiName }),
      securityGroup: ec2SecurityGroup,
      keyName
    });
    // == == == == == == === Certificate == == == == == == ==

    const domainName = 'test-pl.ultorex.org';
    const mainDomainName = 'ultorex.org';
    const hostedZone = HostedZone.fromLookup(this, 'UltorexHostedZone', {
      domainName: mainDomainName
    });
    const cloudFrontCertificate =
      new aws_certificatemanager.DnsValidatedCertificate(
        this,
        'TestPLCloudFrontCertificate',
        {
          domainName,
          hostedZone,
          region: 'us-east-1',
          cleanupRoute53Records: true,
          validation: CertificateValidation.fromDns(hostedZone)
        }
      );

    const lbCertificate = new aws_certificatemanager.DnsValidatedCertificate(
      this,
      'TestPLLBCertificate',
      {
        domainName,
        hostedZone,
        region: 'ap-southeast-1',
        cleanupRoute53Records: true,
        validation: CertificateValidation.fromDns(hostedZone)
      }
    );

    // == == == == == == === Load Blancer == == == == == == ===
    const target = new aws_elasticloadbalancingv2_targets.IpTarget(
      instance.instancePrivateIp
    );

    const targetGroup = new aws_elasticloadbalancingv2.ApplicationTargetGroup(
      this,
      `${STACK_NAME}TG`,
      {
        vpc,
        port: 80,
        protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
        targetType: aws_elasticloadbalancingv2.TargetType.IP,
        targets: [target]
      }
    );

    const subnets = ['subnet-d9b34abf', 'subnet-de0de396', 'subnet-e33683ba'];

    const lbSecurityGroup = new aws_ec2.SecurityGroup(
      this,
      `${STACK_NAME}LBSG`,
      { vpc }
    );

    const cloudfrontPl = 'pl-31a34658';
    lbSecurityGroup.addIngressRule(Peer.prefixList(cloudfrontPl), Port.tcp(80));

    const lb = new aws_elasticloadbalancingv2.ApplicationLoadBalancer(
      this,
      `${STACK_NAME}LB`,
      {
        vpc,
        vpcSubnets: {
          subnets: subnets.map((subnet) =>
            aws_ec2.Subnet.fromSubnetId(this, subnet, subnet)
          )
        },
        securityGroup: lbSecurityGroup,
        internetFacing: true
      }
    );

    lb.addListener('listener', {
      port: 443,
      defaultAction: ListenerAction.forward([targetGroup]),
      open: false,
      certificates: [ListenerCertificate.fromCertificateManager(lbCertificate)]
    });

    // == == == == == == == Cloud Front == == == == == ==
    const distribution = new aws_cloudfront.Distribution(this, 'TestDist', {
      defaultBehavior: {
        origin: new LoadBalancerV2Origin(lb),
        allowedMethods: AllowedMethods.ALLOW_ALL,
        cachedMethods: CachedMethods.CACHE_GET_HEAD_OPTIONS,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      domainNames: [domainName],
      enableIpv6: false,
      certificate: cloudFrontCertificate
    });

    // == == == == == == == Route53 record == == == == == == == == == ==
    new aws_route53.AaaaRecord(this, 'TestPlRecord', {
      zone: hostedZone,
      target: aws_route53.RecordTarget.fromAlias(
        new CloudFrontTarget(distribution)
      )
    });
  }
}
